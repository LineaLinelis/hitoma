import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "jsonc-parser";

const parseErrors = [];
const config = parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  parseErrors,
  { allowTrailingComma: true },
);
if (parseErrors.length) {
  console.error("wrangler.jsoncの形式を確認してください。");
  process.exit(1);
}
const errors = [];
if (!/^[0-9a-f-]{36}$/i.test(config.d1_databases?.[0]?.database_id ?? ""))
  errors.push("D1 database_idを設定してください。");
if (!/^https:\/\/[^/]+$/.test(config.vars?.APP_ORIGIN ?? ""))
  errors.push("APP_ORIGINに公開先のHTTPSオリジンを設定してください。");
if (!/^app_[a-zA-Z0-9]+$/.test(config.vars?.WORLD_APP_ID ?? ""))
  errors.push("WORLD_APP_IDを設定してください。");
if (!/^rp_[a-zA-Z0-9]+$/.test(config.vars?.WORLD_RP_ID ?? ""))
  errors.push("WORLD_RP_IDを設定してください。");
if (!errors.length) {
  try {
    const secrets = JSON.parse(
      execFileSync(
        "node",
        ["node_modules/wrangler/bin/wrangler.js", "secret", "list"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    for (const key of [
      "WORLD_RP_SIGNING_KEY",
      "SESSION_SECRET",
      "ADMIN_SECRET",
    ]) {
      if (!secrets.some((secret) => secret.name === key))
        errors.push(`${key}をwrangler secret putで設定してください。`);
    }
  } catch {
    errors.push(
      "Cloudflareへの接続とSecret名を確認できませんでした。wrangler login等で認証を設定してください。",
    );
  }
}
if (errors.length) {
  console.error(
    "配備前の確認で未設定項目が見つかりました。\n" +
      errors.map((error) => `  - ${error}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  "設定名を確認しました。CloudflareアカウントがWorkers Freeであることを確認して運用してください。",
);
