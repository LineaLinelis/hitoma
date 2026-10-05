export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN?: string;
  WORLD_APP_ID?: string;
  WORLD_RP_ID?: string;
  WORLD_RP_SIGNING_KEY?: string;
  SESSION_SECRET?: string;
  ADMIN_SECRET?: string;
}

export interface Session {
  worldSession: string;
  tokenId: string;
  expiresAt: number;
}

export interface Challenge {
  nonce: string;
  signal: string;
  expiresAt: number;
  credentialExpiresMin: number;
  expectedSession?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
