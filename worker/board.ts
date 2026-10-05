import {
  CATEGORIES,
  LIMITS,
  type Thread,
  type Category,
  type Reply,
} from "../src/shared";
import { minute, quotaBucket, utcDay } from "./auth";
import { HttpError, type Env, type Session } from "./types";
import { newThread, textField, validId } from "./validation";

export function writeReservations(
  env: Env,
  bucket: string,
  now: number,
): D1PreparedStatement[] {
  const tomorrow = Math.floor(now / 86400) * 86400 + 86400;
  return [
    env.DB.prepare(
      `INSERT INTO daily_usage(day, writes) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET writes = writes + 1`,
    ).bind(utcDay(now)),
    env.DB.prepare(
      `INSERT INTO quotas(bucket, used, last_at, expires_at) VALUES (?, 1, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET used = used + 1, last_at = excluded.last_at`,
    ).bind(bucket, now, tomorrow + 86400),
  ];
}

function pageCursor(value: string | null): { time: number; id: string } | null {
  if (!value) return null;
  if (value.length > 60)
    throw new HttpError(400, "invalid_cursor", "ページ指定が不正です。");
  const [timestamp, id, extra] = value.split("_");
  const time = Number(timestamp);
  if (!Number.isSafeInteger(time) || time < 0 || extra !== undefined)
    throw new HttpError(400, "invalid_cursor", "ページ指定が不正です。");
  return { time, id: validId(id ?? "") };
}

export async function listThreads(url: URL, env: Env, now: number) {
  const category = url.searchParams.get("category");
  if (category && !CATEGORIES.includes(category as Category))
    throw new HttpError(400, "invalid_category", "話題が見つかりません。");
  const cursor = pageCursor(url.searchParams.get("cursor"));
  const where = ["created_at >= ?"];
  const params: (string | number)[] = [now - LIMITS.retentionDays * 86400];
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (cursor) {
    where.push("(created_at, id) < (?, ?)");
    params.push(cursor.time, cursor.id);
  }
  const result = await env.DB.prepare(
    `SELECT id, title, body, category, created_at, reply_count, last_reply_at
    FROM threads WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...params, LIMITS.page + 1)
    .all<Thread>();
  const threads = result.results.slice(0, LIMITS.page);
  const last = threads.at(-1);
  return {
    threads,
    nextCursor:
      result.results.length > LIMITS.page && last
        ? `${last.created_at}_${last.id}`
        : null,
  };
}

export async function threadDetail(
  id: string,
  url: URL,
  env: Env,
  now: number,
) {
  validId(id);
  const thread = await env.DB.prepare(
    `SELECT id, title, body, category, created_at, reply_count, last_reply_at
    FROM threads WHERE id = ? AND created_at >= ?`,
  )
    .bind(id, now - LIMITS.retentionDays * 86400)
    .first<Thread>();
  if (!thread)
    throw new HttpError(
      404,
      "not_found",
      "この投稿は削除されたか、保存期間が過ぎました。",
    );
  const cursor = pageCursor(url.searchParams.get("cursor"));
  const where = ["thread_id = ?"];
  const params: (string | number)[] = [id];
  if (cursor) {
    where.push("(created_at, id) > (?, ?)");
    params.push(cursor.time, cursor.id);
  }
  const result = await env.DB.prepare(
    `SELECT id, thread_id, body, created_at FROM replies WHERE ${where.join(" AND ")}
    ORDER BY created_at ASC, id ASC LIMIT ?`,
  )
    .bind(...params, LIMITS.page + 1)
    .all<Reply>();
  const replies = result.results.slice(0, LIMITS.page);
  const last = replies.at(-1);
  return {
    thread,
    replies,
    nextCursor:
      result.results.length > LIMITS.page && last
        ? `${last.created_at}_${last.id}`
        : null,
  };
}

export async function createThread(
  input: Record<string, unknown>,
  session: Session,
  env: Env,
  now: number,
) {
  const values = newThread(input);
  const id = crypto.randomUUID();
  const bucket = await quotaBucket(session, env, now);
  await env.DB.batch([
    ...writeReservations(env, bucket, now),
    env.DB.prepare(
      "INSERT INTO threads(id, title, body, category, created_at, last_reply_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      values.title,
      values.body,
      values.category,
      minute(now),
      minute(now),
    ),
  ]);
  return { id };
}

export async function createReply(
  threadId: string,
  input: Record<string, unknown>,
  session: Session,
  env: Env,
  now: number,
) {
  validId(threadId);
  if (Object.keys(input).some((key) => key !== "body"))
    throw new HttpError(400, "text_only", "返信できるのはテキストだけです。");
  const body = textField(input.body, "本文", LIMITS.body);
  const thread = await env.DB.prepare(
    "SELECT 1 FROM threads WHERE id = ? AND created_at >= ?",
  )
    .bind(threadId, now - LIMITS.retentionDays * 86400)
    .first();
  if (!thread) throw new HttpError(404, "not_found", "投稿が見つかりません。");
  const id = crypto.randomUUID();
  const bucket = await quotaBucket(session, env, now);
  await env.DB.batch([
    ...writeReservations(env, bucket, now),
    env.DB.prepare(
      "INSERT INTO replies(id, thread_id, body, created_at) VALUES (?, ?, ?, ?)",
    ).bind(id, threadId, body, minute(now)),
  ]);
  return { id };
}

export async function report(
  input: Record<string, unknown>,
  session: Session,
  env: Env,
  now: number,
) {
  if (typeof input.threadId !== "string")
    throw new HttpError(400, "invalid_report", "対象を選んでください。");
  const threadId = validId(input.threadId);
  const replyId =
    typeof input.replyId === "string" ? validId(input.replyId) : null;
  if (!["個人情報", "迷惑行為", "その他"].includes(String(input.reason)))
    throw new HttpError(400, "invalid_report", "理由を選んでください。");
  if (
    !(await env.DB.prepare(
      "SELECT 1 FROM threads WHERE id = ? AND created_at >= ?",
    )
      .bind(threadId, now - LIMITS.retentionDays * 86400)
      .first())
  ) {
    throw new HttpError(404, "not_found", "投稿が見つかりません。");
  }
  if (
    replyId &&
    !(await env.DB.prepare(
      "SELECT 1 FROM replies WHERE id = ? AND thread_id = ?",
    )
      .bind(replyId, threadId)
      .first())
  ) {
    throw new HttpError(404, "not_found", "返信が見つかりません。");
  }
  await env.DB.batch([
    ...writeReservations(env, await quotaBucket(session, env, now), now),
    env.DB.prepare(
      "INSERT INTO reports(id, thread_id, reply_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), threadId, replyId, input.reason, minute(now)),
  ]);
  return { success: true };
}

export async function cleanup(env: Env, now: number) {
  // All scans use expiry indexes; no per-read housekeeping writes.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM threads WHERE created_at < ?").bind(
      now - LIMITS.retentionDays * 86400,
    ),
    env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(
      now - 300,
    ),
    env.DB.prepare("DELETE FROM accepted_proofs WHERE expires_at < ?").bind(
      now,
    ),
    env.DB.prepare("DELETE FROM revoked_tokens WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM quotas WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM daily_usage WHERE day < ?").bind(
      utcDay(now - 3 * 86400),
    ),
  ]);
}
