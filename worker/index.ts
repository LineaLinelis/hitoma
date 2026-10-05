import { LIMITS } from "../src/shared";
import {
  configured,
  createChallenge,
  getSession,
  logout,
  quotaBucket,
  requireSession,
  verifyProof,
} from "./auth";
import {
  cleanup,
  createReply,
  createThread,
  listThreads,
  report,
  threadDetail,
} from "./board";
import { privateHash } from "./crypto";
import { HttpError, type Env } from "./types";
import { jsonBody, sameOrigin, validId } from "./validation";

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cache-Control": "no-store",
};

function json(
  value: unknown,
  status = 200,
  setCookies: string[] = [],
): Response {
  const headers = new Headers({
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
  });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(value), { status, headers });
}

function failure(error: unknown): Response {
  if (error instanceof HttpError)
    return json({ error: error.code, message: error.message }, error.status);
  const message =
    error instanceof Error
      ? `${error.message} ${(error.cause as Error | undefined)?.message ?? ""}`
      : "";
  if (message.includes("quota_cooldown"))
    return json(
      { error: "cooldown", message: "続けて投稿するには30秒お待ちください。" },
      429,
    );
  if (message.includes("session_daily_limit"))
    return json(
      {
        error: "session_daily_limit",
        message:
          "この認証セッションの今日の上限に達しました。明日またお越しください。",
      },
      429,
    );
  if (
    message.includes("board_daily_limit") ||
    message.includes("challenge_daily_limit")
  )
    return json(
      {
        error: "board_daily_limit",
        message: "今日の受付上限に達しました。明日またお越しください。",
      },
      429,
    );
  if (message.includes("board_full"))
    return json(
      {
        error: "board_full",
        message: "保存件数の上限に達しました。空きができるまでお待ちください。",
      },
      503,
    );
  if (
    message.includes("accepted_proofs.digest") ||
    message.includes("proof_replayed")
  )
    return json(
      {
        error: "proof_replayed",
        message: "この認証は使用済みです。もう一度認証してください。",
      },
      401,
    );
  // No logging of requests, proof payloads, cookies, identifiers, or IPs.
  return json(
    {
      error: "temporarily_unavailable",
      message:
        "現在、掲示板を利用できません。無料枠の上限や接続状態を確認し、時間をおいてお試しください。",
    },
    503,
  );
}

async function authorizeAdmin(request: Request, env: Env) {
  const token =
    request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (
    !env.ADMIN_SECRET ||
    env.ADMIN_SECRET.length < 32 ||
    !token ||
    token.length > 256
  ) {
    throw new HttpError(401, "admin_required", "管理権限が必要です。");
  }
  const [actual, expected] = await Promise.all([
    privateHash(env.ADMIN_SECRET, "admin", token),
    privateHash(env.ADMIN_SECRET, "admin", env.ADMIN_SECRET),
  ]);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (mismatch)
    throw new HttpError(401, "admin_required", "管理権限が必要です。");
}

export async function handleRequest(
  request: Request,
  env: Env,
  now = Math.floor(Date.now() / 1000),
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "GET" && url.pathname === "/api/config") {
      return json({
        configured: configured(env),
        appId: configured(env) ? env.WORLD_APP_ID : null,
        limits: LIMITS,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      const session = await getSession(request, env, now);
      if (!session) return json({ verified: false });
      const bucket = await quotaBucket(session, env, now);
      const quota = await env.DB.prepare(
        "SELECT used, last_at FROM quotas WHERE bucket = ?",
      )
        .bind(bucket)
        .first<{ used: number; last_at: number }>();
      return json({
        verified: true,
        expiresAt: session.expiresAt,
        writesRemaining: LIMITS.sessionDailyWrites - (quota?.used ?? 0),
        nextWriteAt: (quota?.last_at ?? 0) + LIMITS.cooldownSeconds,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/threads")
      return json(await listThreads(url, env, now));
    const detail = /^\/api\/threads\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && detail)
      return json(await threadDetail(detail[1], url, env, now));

    if (url.pathname.startsWith("/api/admin/")) {
      await authorizeAdmin(request, env);
      if (request.method === "GET" && url.pathname === "/api/admin/reports") {
        const reports = await env.DB.prepare(
          `SELECT reports.*, threads.title, threads.body AS thread_body, replies.body AS reply_body
          FROM reports JOIN threads ON threads.id = reports.thread_id LEFT JOIN replies ON replies.id = reports.reply_id
          ORDER BY reports.created_at DESC LIMIT 100`,
        ).all();
        return json({ reports: reports.results });
      }
      const target = /^\/api\/admin\/(threads|replies)\/([^/]+)$/.exec(
        url.pathname,
      );
      if (request.method === "DELETE" && target) {
        const id = validId(target[2]);
        const result = await env.DB.prepare(
          `DELETE FROM ${target[1]} WHERE id = ?`,
        )
          .bind(id)
          .run();
        if (!result.meta.changes)
          throw new HttpError(404, "not_found", "投稿が見つかりません。");
        return json({ success: true });
      }
      throw new HttpError(404, "not_found", "操作が見つかりません。");
    }
    if (request.method !== "POST")
      throw new HttpError(
        405,
        "method_not_allowed",
        "この操作は利用できません。",
      );
    sameOrigin(request, env.APP_ORIGIN);
    if (url.pathname === "/api/auth/challenge") {
      const challenge = await createChallenge(request, env, now);
      return json(challenge.data, 200, [challenge.cookie]);
    }
    if (url.pathname === "/api/auth/verify") {
      const result = await verifyProof(
        request,
        await jsonBody(request, 32768),
        env,
        now,
      );
      return json(
        { verified: true, expiresAt: result.expiresAt },
        200,
        result.cookies,
      );
    }
    if (url.pathname === "/api/auth/logout")
      return json({ verified: false }, 200, await logout(request, env, now));
    const session = await requireSession(request, env, now);
    const body = await jsonBody(request);
    if (url.pathname === "/api/threads")
      return json(await createThread(body, session, env, now), 201);
    const reply = /^\/api\/threads\/([^/]+)\/replies$/.exec(url.pathname);
    if (reply)
      return json(await createReply(reply[1], body, session, env, now), 201);
    if (url.pathname === "/api/reports")
      return json(await report(body, session, env, now), 201);
    throw new HttpError(404, "not_found", "操作が見つかりません。");
  } catch (error) {
    return failure(error);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await cleanup(env, Math.floor(Date.now() / 1000));
  },
} satisfies ExportedHandler<Env>;
