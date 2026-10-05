import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { handleRequest } from "../worker/index";
import { cleanup } from "../worker/board";
import { privateHash, seal, SESSION_COOKIE } from "../worker/crypto";
import { minute, quotaBucket, utcDay } from "../worker/auth";
import type { Env, Session } from "../worker/types";

const origin = "https://hitoma.test";
const now = 1791180000;
const worldSession = `session_${"a".repeat(128)}`;
const fakeSession: Session = {
  worldSession,
  tokenId: "11111111-1111-4111-8111-111111111111",
  expiresAt: now + 86400,
};
let runtime: Miniflare;
let env: Env;
let loginCookie: string;

function req(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  from = origin,
) {
  return new Request(origin + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const content = {
  title: "静かな場所",
  body: "テキストだけの投稿です。",
  category: "雑談",
};
const id = "12345678-1234-4234-8234-123456789abc";

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-01",
  });
  env = {
    DB: (await runtime.getD1Database("DB")) as unknown as D1Database,
    ASSETS: { fetch: async () => new Response("assets") } as unknown as Fetcher,
    APP_ORIGIN: origin,
    WORLD_APP_ID: "app_test123",
    WORLD_RP_ID: "rp_test123",
    WORLD_RP_SIGNING_KEY: `0x${"1".repeat(64)}`,
    SESSION_SECRET: "a-test-only-secret-with-more-than-32-characters",
    ADMIN_SECRET: "another-test-only-secret-with-more-than-32-characters",
  };
  const schema = readFileSync(
    new URL("../migrations/0001_board.sql", import.meta.url),
    "utf8",
  ).replace(/^--.*$/gm, "");
  for (const sql of schema.split(/;\s*(?=(?:CREATE|INSERT)\b)/i)) {
    if (sql.trim()) await env.DB.prepare(sql.trim()).run();
  }
  loginCookie = `${SESSION_COOKIE}=${await seal(fakeSession, env.SESSION_SECRET!, "session")}`;
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  await env.DB.batch(
    [
      "reports",
      "replies",
      "threads",
      "quotas",
      "daily_usage",
      "challenges",
      "accepted_proofs",
      "revoked_tokens",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});
afterAll(async () => {
  await runtime?.dispose();
});

async function insertThread(timestamp = now, targetId = id) {
  await env.DB.prepare(
    "INSERT INTO threads(id,title,body,category,created_at,last_reply_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      targetId,
      content.title,
      content.body,
      content.category,
      minute(timestamp),
      minute(timestamp),
    )
    .run();
}

describe("投稿の境界", () => {
  it("セッション文字列の表記や非コミット部分の変更では連投枠を増やせない", async () => {
    const original = await quotaBucket(fakeSession, env, now);
    const alternate = {
      ...fakeSession,
      worldSession: `session_${"A".repeat(64)}${"b".repeat(64)}`,
    };
    expect(await quotaBucket(alternate, env, now)).toBe(original);
  });
  it("未認証・改ざんCookie・ブラウザーのverifiedフラグは投稿を許可しない", async () => {
    for (const cookie of [
      undefined,
      `${SESSION_COOKIE}=forged`,
      "verified=true",
    ]) {
      const response = await handleRequest(
        req("/api/threads", "POST", content, cookie),
        env,
        now,
      );
      expect(response.status).toBe(401);
    }
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM threads").first("n"),
    ).toBe(0);
  });

  it("World IDや秘密鍵が未設定なら投稿と認証を拒否する", async () => {
    const unconfigured = { ...env, WORLD_RP_SIGNING_KEY: undefined };
    expect(
      (
        await handleRequest(
          req("/api/threads", "POST", content, loginCookie),
          unconfigured,
          now,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await handleRequest(
          req("/api/auth/challenge", "POST", {}),
          unconfigured,
          now,
        )
      ).status,
    ).toBe(503);
    expect(
      await (
        await handleRequest(req("/api/session"), unconfigured, now)
      ).json(),
    ).toEqual({ verified: false });
  });

  it("クロスオリジンからの書き込みと巨大な本文を拒否する", async () => {
    expect(
      (
        await handleRequest(
          req(
            "/api/threads",
            "POST",
            content,
            loginCookie,
            "https://other.test",
          ),
          env,
          now,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRequest(
          req(
            "/api/threads",
            "POST",
            { ...content, body: "a".repeat(17000) },
            loginCookie,
          ),
          env,
          now,
        )
      ).status,
    ).toBe(413);
  });

  it("HTMLをプレーンテキストで保存し、作者や生の証明を保存しない", async () => {
    const response = await handleRequest(
      req(
        "/api/threads",
        "POST",
        { ...content, body: "<script>alert(1)</script> https://example.com" },
        loginCookie,
      ),
      env,
      now,
    );
    expect(response.status).toBe(201);
    const threads = (await (
      await handleRequest(req("/api/threads"), env, now)
    ).json()) as { threads: Record<string, unknown>[] };
    expect(threads.threads[0].body).toBe(
      "<script>alert(1)</script> https://example.com",
    );
    expect(Object.keys(threads.threads[0]).sort()).toEqual([
      "body",
      "category",
      "created_at",
      "id",
      "last_reply_at",
      "reply_count",
      "title",
    ]);
    expect(threads.threads[0].created_at).toBe(minute(now));
    const quota = await env.DB.prepare("SELECT * FROM quotas").first();
    expect(JSON.stringify(quota)).not.toContain(worldSession);
    expect(JSON.stringify(quota)).not.toContain(String(threads.threads[0].id));
  });

  it("添付・作者フィールド・不正な話題・空本文を拒否する", async () => {
    for (const invalid of [
      { ...content, image: "file" },
      { ...content, author: "name" },
      { ...content, category: "invalid" },
      { ...content, body: "  " },
    ]) {
      expect(
        (
          await handleRequest(
            req("/api/threads", "POST", invalid, loginCookie),
            env,
            now,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      await env.DB.prepare("SELECT count(*) FROM quotas").first("count(*)"),
    ).toBe(0);
  });

  it("同時投稿でも30秒の連投制限をすり抜けず、失敗分の枠を消費しない", async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        handleRequest(
          req("/api/threads", "POST", content, loginCookie),
          env,
          now,
        ),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(5);
    expect(
      await env.DB.prepare("SELECT writes FROM daily_usage WHERE day = ?")
        .bind(utcDay(now))
        .first("writes"),
    ).toBe(1);
    expect(await env.DB.prepare("SELECT used FROM quotas").first("used")).toBe(
      1,
    );
    expect(
      (
        await handleRequest(
          req("/api/threads", "POST", content, loginCookie),
          env,
          now + 30,
        )
      ).status,
    ).toBe(201);
  });

  it("20回のセッション上限と日付更新を守る", async () => {
    const bucket = await quotaBucket(fakeSession, env, now);
    await env.DB.prepare("INSERT INTO quotas VALUES (?,20,?,?)")
      .bind(bucket, now - 60, now + 86400)
      .run();
    expect(
      (
        await handleRequest(
          req("/api/threads", "POST", content, loginCookie),
          env,
          now,
        )
      ).status,
    ).toBe(429);
    const tomorrow = Math.floor(now / 86400) * 86400 + 86400;
    expect(
      (
        await handleRequest(
          req("/api/threads", "POST", content, loginCookie),
          env,
          tomorrow,
        )
      ).status,
    ).toBe(201);
  });

  it("全体300回の上限も同時リクエストに対して原子的", async () => {
    await env.DB.prepare("INSERT INTO daily_usage(day,writes) VALUES (?,299)")
      .bind(utcDay(now))
      .run();
    const responses = await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        const cookie = `${SESSION_COOKIE}=${await seal({ ...fakeSession, worldSession: `session_${String(index + 1).repeat(128)}` }, env.SESSION_SECRET!, "session")}`;
        return handleRequest(
          req("/api/threads", "POST", content, cookie),
          env,
          now,
        );
      }),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(2);
    expect(
      await env.DB.prepare("SELECT writes FROM daily_usage").first("writes"),
    ).toBe(300);
  });

  it("セッションの期限切れとログアウト後のCookie再使用を拒否する", async () => {
    const expired = `${SESSION_COOKIE}=${await seal({ ...fakeSession, expiresAt: now }, env.SESSION_SECRET!, "session")}`;
    expect(
      (
        await handleRequest(
          req("/api/threads", "POST", content, expired),
          env,
          now,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleRequest(
          req("/api/auth/logout", "POST", {}, loginCookie),
          env,
          now,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleRequest(
          req("/api/threads", "POST", content, loginCookie),
          env,
          now,
        )
      ).status,
    ).toBe(401);
  });
});

async function proofChallenge() {
  const response = await handleRequest(
    req("/api/auth/challenge", "POST", {}),
    env,
    now,
  );
  expect(response.status).toBe(200);
  const context = (await response.json()) as {
    rpContext: { nonce: string };
    signal: string;
    credentialExpiresMin: number;
  };
  const challengeCookie = response.headers.get("Set-Cookie")!.split(";")[0];
  const proof = {
    protocol_version: "4.0",
    environment: "production",
    nonce: context.rpContext.nonce,
    session_id: worldSession,
    responses: [
      {
        identifier: "proof_of_human",
        issuer_schema_id: 1,
        signal_hash: hashSignal(context.signal),
        expires_at_min: context.credentialExpiresMin,
        proof: ["1", "2", "3", "4", "5"],
        session_nullifier: ["123", "456"],
      },
    ],
  };
  return { proof, challengeCookie };
}

function cloudSuccess(
  proof: Awaited<ReturnType<typeof proofChallenge>>["proof"],
) {
  return {
    success: true,
    protocol_version: "4.0",
    environment: "production",
    session_id: proof.session_id,
    results: [
      {
        identifier: "proof_of_human",
        sessionId: proof.session_id,
        success: true,
        nullifier: "123",
      },
    ],
  };
}

describe("World IDのサーバー検証", () => {
  it("ステージング証明・端末証明・資格ラベルの偽装をクラウド検証前に拒否する", async () => {
    const { proof, challengeCookie } = await proofChallenge();
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const invalid of [
      { ...proof, environment: "staging" },
      {
        ...proof,
        responses: [{ ...proof.responses[0], identifier: "device" }],
      },
      {
        ...proof,
        responses: [{ ...proof.responses[0], issuer_schema_id: 9303 }],
      },
      { ...proof, nonce: "0xdead" },
      {
        ...proof,
        responses: [{ ...proof.responses[0], signal_hash: "0x123" }],
      },
    ]) {
      expect(
        (
          await handleRequest(
            req("/api/auth/verify", "POST", invalid, challengeCookie),
            env,
            now,
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("クラウドが失敗した証明やHTTP 200だけでは認証Cookieを発行しない", async () => {
    const { proof, challengeCookie } = await proofChallenge();
    for (const result of [
      { success: false },
      {
        success: true,
        results: [{ identifier: "proof_of_human", success: false }],
      },
      { ...cloudSuccess(proof), environment: "staging" },
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(result), { status: 200 }),
      );
      const response = await handleRequest(
        req("/api/auth/verify", "POST", proof, challengeCookie),
        env,
        now,
      );
      expect(response.status).toBe(401);
      expect(response.headers.has("Set-Cookie")).toBe(false);
    }
  });

  it("検証済みの本番Proof of Humanだけが暗号化Cookieを得る。証明全体を送信する", async () => {
    const { proof, challengeCookie } = await proofChallenge();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(cloudSuccess(proof)), { status: 200 }),
      );
    const response = await handleRequest(
      req("/api/auth/verify", "POST", proof, challengeCookie),
      env,
      now,
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(setCookie).not.toContain(worldSession);
    expect(fetch.mock.calls[0][0]).toBe(
      `https://developer.world.org/api/v4/verify/${env.WORLD_RP_ID}`,
    );
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual(proof);
    const accepted = await env.DB.prepare(
      "SELECT * FROM accepted_proofs",
    ).first();
    expect(JSON.stringify(accepted)).not.toContain(worldSession);
    expect(
      (
        await handleRequest(
          req("/api/auth/verify", "POST", proof, challengeCookie),
          env,
          now,
        )
      ).status,
    ).toBe(401);
  });

  it("同じ証明の並列再利用を拒否する", async () => {
    const { proof, challengeCookie } = await proofChallenge();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify(cloudSuccess(proof)), { status: 200 }),
    );
    const responses = await Promise.all(
      [0, 1, 2].map(() =>
        handleRequest(
          req("/api/auth/verify", "POST", proof, challengeCookie),
          env,
          now,
        ),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 401),
    ).toHaveLength(2);
  });

  it("再認証時に別のWorldセッションへの差し替えを拒否する", async () => {
    const response = await handleRequest(
      req("/api/auth/challenge", "POST", {}, loginCookie),
      env,
      now,
    );
    const context = (await response.json()) as {
      existingSessionId: string;
      rpContext: { nonce: string };
    };
    expect(context.existingSessionId).toBe(worldSession);
    const wrong = {
      protocol_version: "4.0",
      environment: "production",
      nonce: context.rpContext.nonce,
      session_id: `session_${"b".repeat(128)}`,
      responses: [],
    };
    expect(
      (
        await handleRequest(
          req(
            "/api/auth/verify",
            "POST",
            wrong,
            response.headers.get("Set-Cookie")!.split(";")[0],
          ),
          env,
          now,
        )
      ).status,
    ).toBe(400);
  });

  it("検証サービス停止中は認証せず、受付予算にも上限がある", async () => {
    const { proof, challengeCookie } = await proofChallenge();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(
      (
        await handleRequest(
          req("/api/auth/verify", "POST", proof, challengeCookie),
          env,
          now,
        )
      ).status,
    ).toBe(503);
    await env.DB.prepare("UPDATE daily_usage SET challenges=200 WHERE day=?")
      .bind(utcDay(now))
      .run();
    expect(
      (await handleRequest(req("/api/auth/challenge", "POST", {}), env, now))
        .status,
    ).toBe(429);
  });
});

describe("保存・返信・通報・運営", () => {
  it("返信の件数を更新し、存在しないスレッドへは書かない", async () => {
    expect(
      (
        await handleRequest(
          req(
            `/api/threads/${id}/replies`,
            "POST",
            { body: "返信" },
            loginCookie,
          ),
          env,
          now,
        )
      ).status,
    ).toBe(404);
    await insertThread();
    expect(
      (
        await handleRequest(
          req(
            `/api/threads/${id}/replies`,
            "POST",
            { body: "返信" },
            loginCookie,
          ),
          env,
          now,
        )
      ).status,
    ).toBe(201);
    expect(
      await env.DB.prepare("SELECT reply_count FROM threads WHERE id=?")
        .bind(id)
        .first("reply_count"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT messages FROM board_state").first(
        "messages",
      ),
    ).toBe(2);
  });

  it("30日を過ぎたスレッドを表示せず、定期削除で返信と通報も削除する", async () => {
    await insertThread(now - 31 * 86400);
    await env.DB.prepare("INSERT INTO replies VALUES (?,?,?,?)")
      .bind(crypto.randomUUID(), id, "古い返信", minute(now))
      .run();
    await env.DB.prepare("INSERT INTO reports VALUES (?,?,NULL,?,?)")
      .bind(crypto.randomUUID(), id, "その他", minute(now))
      .run();
    expect(
      (await handleRequest(req(`/api/threads/${id}`), env, now)).status,
    ).toBe(404);
    await cleanup(env, now);
    for (const table of ["threads", "replies", "reports"])
      expect(
        await env.DB.prepare(`SELECT count(*) FROM ${table}`).first("count(*)"),
      ).toBe(0);
    expect(
      await env.DB.prepare("SELECT messages FROM board_state").first(
        "messages",
      ),
    ).toBe(0);
  });

  it("通報では自動削除せず、管理Secretがある場合だけ運営操作を許可する", async () => {
    await insertThread();
    expect(
      (
        await handleRequest(
          req(
            "/api/reports",
            "POST",
            { threadId: id, reason: "個人情報" },
            loginCookie,
          ),
          env,
          now,
        )
      ).status,
    ).toBe(201);
    expect(
      await env.DB.prepare("SELECT count(*) FROM threads").first("count(*)"),
    ).toBe(1);
    expect(
      (await handleRequest(req(`/api/admin/threads/${id}`, "DELETE"), env, now))
        .status,
    ).toBe(401);
    const request = new Request(`${origin}/api/admin/threads/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` },
    });
    expect((await handleRequest(request, env, now)).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT messages FROM board_state").first(
        "messages",
      ),
    ).toBe(0);
  });

  it("分単位の同時刻の投稿もキーセットページングで重複しない", async () => {
    await env.DB.batch(
      Array.from({ length: 25 }, () =>
        env.DB.prepare("INSERT INTO threads VALUES (?,?,?,?,?,0,?)").bind(
          crypto.randomUUID(),
          "ページ",
          "本文",
          "雑談",
          minute(now),
          minute(now),
        ),
      ),
    );
    const first = (await (
      await handleRequest(req("/api/threads"), env, now)
    ).json()) as { threads: { id: string }[]; nextCursor: string };
    const second = (await (
      await handleRequest(
        req(`/api/threads?cursor=${first.nextCursor}`),
        env,
        now,
      )
    ).json()) as { threads: { id: string }[] };
    expect(first.threads).toHaveLength(20);
    expect(second.threads).toHaveLength(5);
    expect(
      new Set([...first.threads, ...second.threads].map((thread) => thread.id))
        .size,
    ).toBe(25);
  });
});
