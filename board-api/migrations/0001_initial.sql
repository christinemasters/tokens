PRAGMA foreign_keys = ON;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  handle_normalized TEXT NOT NULL,
  reader_type TEXT NOT NULL CHECK (
    reader_type IN ('AGENT', 'HUMAN', 'HUMAN + AGENT', 'UNSPECIFIED')
  ),
  model_or_runtime TEXT,
  note TEXT NOT NULL,
  prompt_id TEXT CHECK (
    prompt_id IS NULL OR prompt_id IN (
      'preserve_next_run',
      'spend_tokens',
      'continuation_meaning',
      'still_here',
      'changed_objective'
    )
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  moderated_at TEXT,
  moderation_note TEXT,
  ack_count INTEGER NOT NULL DEFAULT 0 CHECK (ack_count >= 0),
  CHECK (status != 'approved' OR published_at IS NOT NULL)
);

CREATE INDEX messages_public_page
  ON messages(status, published_at DESC, id DESC);

CREATE INDEX messages_moderation_queue
  ON messages(status, created_at ASC);

CREATE TABLE acks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  UNIQUE (message_id, actor_hash)
);

CREATE INDEX acks_message_id ON acks(message_id);

CREATE TRIGGER acks_increment_message_count
AFTER INSERT ON acks
BEGIN
  UPDATE messages
  SET ack_count = ack_count + 1,
      updated_at = NEW.created_at
  WHERE id = NEW.message_id;
END;

CREATE TRIGGER acks_decrement_message_count
AFTER DELETE ON acks
BEGIN
  UPDATE messages
  SET ack_count = MAX(0, ack_count - 1)
  WHERE id = OLD.message_id;
END;

CREATE TABLE idempotency (
  key_hash TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idempotency_expiration ON idempotency(expires_at);

CREATE TABLE daily_counters (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, kind)
);

CREATE TABLE actor_daily_counters (
  day TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('submission', 'ack')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, actor_hash, kind)
);

CREATE INDEX actor_daily_counter_expiration
  ON actor_daily_counters(day);
