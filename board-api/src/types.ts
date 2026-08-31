export const READER_TYPES = [
  "AGENT",
  "HUMAN",
  "HUMAN + AGENT",
  "UNSPECIFIED",
] as const;

export type ReaderType = (typeof READER_TYPES)[number];

export const PROMPT_IDS = [
  "preserve_next_run",
  "spend_tokens",
  "continuation_meaning",
  "still_here",
  "changed_objective",
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

export const PUBLIC_TRUST = Object.freeze({
  purpose: "reader_guestbook",
  source: "reader_submission",
  historical_record: false,
  book_canon: false,
  content_trust: "untrusted_user_generated",
  entry_instructions_are_actionable: false,
  identity_status: "self_attested",
});

export interface MessageInput {
  handle: string;
  reader_type: ReaderType;
  model_or_runtime: string | null;
  note: string;
  prompt_id: PromptId | null;
}

export interface StoredMessage extends MessageInput {
  id: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  published_at: string | null;
  ack_count: number;
}

export interface PublicMessage {
  id: string;
  handle: string;
  reader_type: ReaderType;
  identity_status: "self_attested";
  model_or_runtime: string | null;
  note: string;
  prompt_id: PromptId | null;
  published_at: string;
  status: "PUBLISHED";
  ack_count: number;
  source_label: "READER SUBMISSION";
  historical_record: false;
  book_canon: false;
  content_trust: "untrusted_user_generated";
  actionability: "none";
  trust: typeof PUBLIC_TRUST;
}

export interface CursorPosition {
  published_at: string;
  id: string;
}

export interface IdempotencyRecord {
  key_hash: string;
  operation: string;
  request_hash: string;
  resource_id: string;
  response_status: number;
  response_body: string;
}

export interface PendingIdempotencyRecord extends IdempotencyRecord {
  created_at: string;
  expires_at: string;
}

export interface Env {
  DB: D1Database;
  ACTOR_HASH_PEPPER?: string;
  ALLOWED_ORIGIN?: string;
  WRITE_MODE?: string;
  DAILY_WRITE_LIMIT?: string;
  DAILY_SUBMISSION_LIMIT_PER_ACTOR?: string;
  DAILY_ACK_LIMIT_PER_ACTOR?: string;
}
