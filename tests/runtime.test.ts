import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["worker/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  runtime = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB"],
    bindings: {
      APP_ORIGIN: "https://hitoma.test",
      WORLD_APP_ID: "app_test123",
      WORLD_RP_ID: "rp_test123",
      WORLD_RP_SIGNING_KEY: `0x${"1".repeat(64)}`,
      SESSION_SECRET: "a-test-only-secret-with-more-than-32-characters",
    },
  });
  const db = await runtime.getD1Database("DB");
  const schema = readFileSync(
    new URL("../migrations/0001_board.sql", import.meta.url),
    "utf8",
  ).replace(/^--.*$/gm, "");
  for (const sql of schema.split(/;\s*(?=(?:CREATE|INSERT)\b)/i))
    if (sql.trim()) await db.prepare(sql.trim()).run();
});
afterAll(async () => {
  await runtime?.dispose();
});

it("本物のWorkersランタイムで初回から署名ができ、Node互換機能なしで動く", async () => {
  const response = await runtime.dispatchFetch(
    "https://hitoma.test/api/auth/challenge",
    {
      method: "POST",
      headers: {
        Origin: "https://hitoma.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    rpContext: { signature: string; nonce: string };
  };
  expect(body.rpContext.signature).toMatch(/^0x[0-9a-f]{130}$/);
  expect(body.rpContext.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  expect(response.headers.get("Set-Cookie")).toContain(
    "HttpOnly; Secure; SameSite=Strict",
  );
});

it("配備するWorker自体も、API直呼びでの未認証投稿を拒否する", async () => {
  const response = await runtime.dispatchFetch(
    "https://hitoma.test/api/threads",
    {
      method: "POST",
      headers: {
        Origin: "https://hitoma.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "test", body: "test", category: "雑談" }),
    },
  );
  expect(response.status).toBe(401);
});
