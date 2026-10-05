-- The board has no users table. Posts have no author, session, proof, or IP column.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  category TEXT NOT NULL CHECK(category IN ('雑談','問い','テクノロジー','暮らし')),
  created_at INTEGER NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_at INTEGER NOT NULL
);
CREATE INDEX threads_new ON threads(created_at DESC, id DESC);
CREATE INDEX threads_category_new ON threads(category, created_at DESC, id DESC);

CREATE TABLE replies (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);
CREATE INDEX replies_thread ON replies(thread_id, created_at, id);

CREATE TABLE board_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  messages INTEGER NOT NULL DEFAULT 0 CHECK(messages BETWEEN 0 AND 10000)
);
INSERT INTO board_state(id) VALUES (1);

CREATE TABLE daily_usage (
  day TEXT PRIMARY KEY,
  writes INTEGER NOT NULL DEFAULT 0 CHECK(writes BETWEEN 0 AND 300),
  challenges INTEGER NOT NULL DEFAULT 0 CHECK(challenges BETWEEN 0 AND 200)
);

-- Daily HMAC of the private World session. Never associated with a post ID.
CREATE TABLE quotas (
  bucket TEXT PRIMARY KEY,
  used INTEGER NOT NULL CHECK(used BETWEEN 1 AND 20),
  last_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX quotas_expiry ON quotas(expires_at);
CREATE TRIGGER quota_cooldown BEFORE UPDATE ON quotas
WHEN NEW.last_at - OLD.last_at < 30
BEGIN SELECT RAISE(ABORT, 'quota_cooldown'); END;

CREATE TABLE challenges (
  nonce_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE INDEX challenges_expiry ON challenges(expires_at);
CREATE TRIGGER challenge_once BEFORE UPDATE OF consumed ON challenges
WHEN OLD.consumed = 1 AND NEW.consumed = 1
BEGIN SELECT RAISE(ABORT, 'proof_replayed'); END;

-- Only keyed digests for proof deduplication and token revocation, with bounded TTLs.
CREATE TABLE accepted_proofs (
  digest TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX accepted_proofs_expiry ON accepted_proofs(expires_at);
CREATE TABLE revoked_tokens (
  digest TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX revoked_tokens_expiry ON revoked_tokens(expires_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  reply_id TEXT REFERENCES replies(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('個人情報','迷惑行為','その他')),
  created_at INTEGER NOT NULL
);
CREATE INDEX reports_created ON reports(created_at DESC);

CREATE TRIGGER board_cap BEFORE UPDATE ON board_state
WHEN NEW.messages > 10000
BEGIN SELECT RAISE(ABORT, 'board_full'); END;
CREATE TRIGGER board_daily_cap BEFORE UPDATE ON daily_usage
WHEN NEW.writes > 300
BEGIN SELECT RAISE(ABORT, 'board_daily_limit'); END;
CREATE TRIGGER challenge_daily_cap BEFORE UPDATE ON daily_usage
WHEN NEW.challenges > 200
BEGIN SELECT RAISE(ABORT, 'challenge_daily_limit'); END;
CREATE TRIGGER quota_daily_cap BEFORE UPDATE ON quotas
WHEN NEW.used > 20
BEGIN SELECT RAISE(ABORT, 'session_daily_limit'); END;

CREATE TRIGGER thread_added AFTER INSERT ON threads
BEGIN UPDATE board_state SET messages = messages + 1 WHERE id = 1; END;
CREATE TRIGGER thread_removed AFTER DELETE ON threads
BEGIN UPDATE board_state SET messages = messages - 1 WHERE id = 1; END;
CREATE TRIGGER reply_added AFTER INSERT ON replies
BEGIN
  UPDATE board_state SET messages = messages + 1 WHERE id = 1;
  UPDATE threads SET reply_count = reply_count + 1, last_reply_at = NEW.created_at WHERE id = NEW.thread_id;
END;
CREATE TRIGGER reply_removed AFTER DELETE ON replies
BEGIN
  UPDATE board_state SET messages = messages - 1 WHERE id = 1;
  UPDATE threads SET reply_count = reply_count - 1 WHERE id = OLD.thread_id;
END;
