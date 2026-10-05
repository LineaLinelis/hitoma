import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { getSessionCommitment } from "@worldcoin/idkit-core/session";
import type { RpContext } from "@worldcoin/idkit-core";
import { LIMITS } from "../src/shared";
import {
  cookie,
  cookies,
  privateHash,
  seal,
  unseal,
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
} from "./crypto";
import { HttpError, type Env, type Session, type Challenge } from "./types";
import { signSessionRequest } from "./signing";

export function configured(env: Env): boolean {
  return !!(
    env.APP_ORIGIN &&
    /^https:\/\/[^/]+$/.test(env.APP_ORIGIN) &&
    /^app_[a-zA-Z0-9]+$/.test(env.WORLD_APP_ID ?? "") &&
    /^rp_[a-zA-Z0-9]+$/.test(env.WORLD_RP_ID ?? "") &&
    /^(0x)?[0-9a-f]{64}$/i.test(env.WORLD_RP_SIGNING_KEY ?? "") &&
    (env.SESSION_SECRET?.length ?? 0) >= 32
  );
}

export function requireConfigured(env: Env) {
  if (!configured(env))
    throw new HttpError(
      503,
      "setup_required",
      "World IDの準備中です。認証を設定すると投稿できます。",
    );
}

export const utcDay = (now: number) =>
  new Date(now * 1000).toISOString().slice(0, 10);
export const minute = (now: number) => Math.floor(now / 60) * 60;

export async function quotaBucket(session: Session, env: Env, now: number) {
  return privateHash(
    env.SESSION_SECRET!,
    "quota",
    `${utcDay(now)}:${getSessionCommitment(session.worldSession).toString()}`,
  );
}

export async function getSession(
  request: Request,
  env: Env,
  now: number,
  allowExpired = false,
): Promise<Session | null> {
  if (!configured(env)) return null;
  const session = await unseal<Session>(
    cookies(request)[SESSION_COOKIE],
    env.SESSION_SECRET!,
    "session",
  );
  if (
    !session ||
    !/^session_[0-9a-f]{128}$/i.test(session.worldSession) ||
    typeof session.tokenId !== "string" ||
    session.tokenId.length !== 36 ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt > now + LIMITS.sessionSeconds + 60 ||
    session.expiresAt <= now - (allowExpired ? LIMITS.sessionSeconds : 0)
  )
    return null;
  const digest = await privateHash(
    env.SESSION_SECRET!,
    "revoke",
    session.tokenId,
  );
  if (
    await env.DB.prepare(
      "SELECT 1 FROM revoked_tokens WHERE digest = ? AND expires_at > ?",
    )
      .bind(digest, now)
      .first()
  )
    return null;
  return session;
}

export async function requireSession(
  request: Request,
  env: Env,
  now: number,
): Promise<Session> {
  requireConfigured(env);
  const session = await getSession(request, env, now);
  if (!session)
    throw new HttpError(
      401,
      "human_verification_required",
      "投稿するにはWorld IDで人間性を確認してください。",
    );
  return session;
}

/** Signature + encrypted browser challenge. Production only; no simulator path. */
export async function createChallenge(request: Request, env: Env, now: number) {
  requireConfigured(env);
  const existing = await getSession(request, env, now);
  const signature = signSessionRequest(env.WORLD_RP_SIGNING_KEY!, now);
  const challenge: Challenge = {
    nonce: signature.nonce,
    signal: crypto.randomUUID(),
    expiresAt: signature.expiresAt,
    credentialExpiresMin: now + LIMITS.sessionSeconds,
    ...(existing ? { expectedSession: existing.worldSession } : {}),
  };
  const nonceHash = await privateHash(
    env.SESSION_SECRET!,
    "challenge",
    challenge.nonce,
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO daily_usage(day, challenges) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET challenges = challenges + 1`,
    ).bind(utcDay(now)),
    env.DB.prepare(
      "INSERT INTO challenges(nonce_hash, expires_at) VALUES (?, ?)",
    ).bind(nonceHash, challenge.expiresAt),
  ]);
  const rpContext: RpContext = {
    rp_id: env.WORLD_RP_ID!,
    nonce: signature.nonce,
    created_at: signature.createdAt,
    expires_at: signature.expiresAt,
    signature: signature.sig,
  };
  return {
    data: {
      appId: env.WORLD_APP_ID,
      rpContext,
      signal: challenge.signal,
      credentialExpiresMin: challenge.credentialExpiresMin,
      ...(existing ? { existingSessionId: existing.worldSession } : {}),
    },
    cookie: cookie(
      CHALLENGE_COOKIE,
      await seal(challenge, env.SESSION_SECRET!, "challenge"),
      300,
    ),
  };
}

function field(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)
  )
    return null;
  try {
    return BigInt(value).toString(10);
  } catch {
    return null;
  }
}

/** Never trust a UI flag or the returned identifier alone: issuer schema 1 must be proved. */
export async function verifyProof(
  request: Request,
  proof: Record<string, unknown>,
  env: Env,
  now: number,
) {
  requireConfigured(env);
  const challenge = await unseal<Challenge>(
    cookies(request)[CHALLENGE_COOKIE],
    env.SESSION_SECRET!,
    "challenge",
  );
  if (
    !challenge ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= now ||
    challenge.expiresAt > now + 300 ||
    proof.nonce !== challenge.nonce
  ) {
    throw new HttpError(
      401,
      "challenge_expired",
      "認証の有効時間が切れました。もう一度認証してください。",
    );
  }
  const nonceHash = await privateHash(
    env.SESSION_SECRET!,
    "challenge",
    challenge.nonce,
  );
  const issued = await env.DB.prepare(
    "SELECT consumed FROM challenges WHERE nonce_hash = ? AND expires_at > ?",
  )
    .bind(nonceHash, now)
    .first<{ consumed: number }>();
  if (!issued || issued.consumed)
    throw new HttpError(
      401,
      "proof_replayed",
      "この認証は使用済みです。もう一度認証してください。",
    );
  if (
    proof.protocol_version !== "4.0" ||
    proof.environment !== "production" ||
    typeof proof.session_id !== "string" ||
    !/^session_[0-9a-f]{128}$/i.test(proof.session_id) ||
    (challenge.expectedSession &&
      proof.session_id !== challenge.expectedSession) ||
    !Array.isArray(proof.responses) ||
    proof.responses.length !== 1
  ) {
    throw new HttpError(
      400,
      "invalid_proof",
      "本番用のProof of Humanセッション証明が必要です。",
    );
  }
  const item = proof.responses[0] as Record<string, unknown> | null;
  const signalHash = field(hashSignal(challenge.signal));
  if (
    !item ||
    item.identifier !== "proof_of_human" ||
    item.issuer_schema_id !== 1 ||
    field(item.signal_hash) !== signalHash ||
    !Number.isSafeInteger(item.expires_at_min) ||
    Number(item.expires_at_min) < challenge.credentialExpiresMin ||
    !Array.isArray(item.proof) ||
    item.proof.length !== 5 ||
    item.proof.some((value: unknown) => field(value) === null) ||
    !Array.isArray(item.session_nullifier) ||
    item.session_nullifier.length !== 2 ||
    item.session_nullifier.some((value: unknown) => field(value) === null)
  ) {
    throw new HttpError(
      400,
      "human_proof_required",
      "Proof of Humanの証明が必要です。端末・パスポートの認証では投稿できません。",
    );
  }

  let verified: Record<string, unknown>;
  try {
    const response = await fetch(
      `https://developer.world.org/api/v4/verify/${encodeURIComponent(env.WORLD_RP_ID!)}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hitoma/0.1",
        },
        // Send the complete SDK result; do not invent or remap World response fields.
        body: JSON.stringify(proof),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (response.status >= 500 || response.status === 429)
      throw new Error("verifier_unavailable");
    if (!response.ok)
      throw new HttpError(
        401,
        "world_verification_failed",
        "World IDの証明を確認できませんでした。もう一度認証してください。",
      );
    verified = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "world_unavailable",
      "World IDへの接続が混み合っています。時間をおいてお試しください。",
    );
  }
  const results = verified.results as
    | Array<Record<string, unknown>>
    | undefined;
  const result =
    Array.isArray(results) && results.length === 1 ? results[0] : undefined;
  if (
    verified.success !== true ||
    verified.protocol_version !== "4.0" ||
    verified.environment !== "production" ||
    verified.session_id !== proof.session_id ||
    !result ||
    result.success !== true ||
    result.identifier !== "proof_of_human" ||
    result.sessionId !== proof.session_id ||
    field(result.nullifier) !== field(item.session_nullifier[0])
  ) {
    throw new HttpError(
      401,
      "world_verification_failed",
      "Proof of Humanを確認できませんでした。",
    );
  }
  const digest = await privateHash(
    env.SESSION_SECRET!,
    "proof",
    `${getSessionCommitment(proof.session_id).toString()}:${field(item.session_nullifier[0])}:${field(item.session_nullifier[1])}`,
  );

  // D1 batch is atomic. The unique digest closes parallel replay races.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accepted_proofs(digest, expires_at) VALUES (?, ?)",
    ).bind(digest, now + LIMITS.sessionSeconds),
    env.DB.prepare(
      "UPDATE challenges SET consumed = 1 WHERE nonce_hash = ?",
    ).bind(nonceHash),
  ]);
  const session: Session = {
    worldSession: proof.session_id,
    tokenId: crypto.randomUUID(),
    expiresAt: now + LIMITS.sessionSeconds,
  };
  return {
    expiresAt: session.expiresAt,
    cookies: [
      cookie(
        SESSION_COOKIE,
        await seal(session, env.SESSION_SECRET!, "session"),
        LIMITS.sessionSeconds,
      ),
      cookie(CHALLENGE_COOKIE, "", 0),
    ],
  };
}

export async function logout(request: Request, env: Env, now: number) {
  const session = await getSession(request, env, now);
  if (session) {
    const digest = await privateHash(
      env.SESSION_SECRET!,
      "revoke",
      session.tokenId,
    );
    await env.DB.prepare(
      "INSERT OR IGNORE INTO revoked_tokens(digest, expires_at) VALUES (?, ?)",
    )
      .bind(digest, session.expiresAt)
      .run();
  }
  return [cookie(SESSION_COOKIE, "", 0), cookie(CHALLENGE_COOKIE, "", 0)];
}
