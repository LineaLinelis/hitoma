export const CATEGORIES = ["雑談", "問い", "テクノロジー", "暮らし"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LIMITS = {
  title: 80,
  body: 2000,
  page: 20,
  sessionDailyWrites: 20,
  cooldownSeconds: 30,
  boardDailyWrites: 300,
  boardDailyChallenges: 200,
  storedMessages: 10000,
  retentionDays: 30,
  sessionSeconds: 86400,
} as const;

export interface Thread {
  id: string;
  title: string;
  body: string;
  category: Category;
  created_at: number;
  reply_count: number;
  last_reply_at: number;
}

export interface Reply {
  id: string;
  thread_id: string;
  body: string;
  created_at: number;
}

export interface PublicConfig {
  configured: boolean;
  appId: string | null;
  limits: typeof LIMITS;
}

export interface SessionStatus {
  verified: boolean;
  expiresAt?: number;
  writesRemaining?: number;
  nextWriteAt?: number;
}
