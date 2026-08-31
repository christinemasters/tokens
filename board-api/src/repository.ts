import type {
  CursorPosition,
  IdempotencyRecord,
  PendingIdempotencyRecord,
  StoredMessage,
} from "./types";

export interface BoardRepository {
  listApproved(
    after: CursorPosition | null,
    fetchLimit: number,
  ): Promise<StoredMessage[]>;
  findIdempotency(
    keyHash: string,
    now: string,
  ): Promise<IdempotencyRecord | null>;
  deleteExpiredIdempotency(keyHash: string, now: string): Promise<void>;
  createMessage(
    message: StoredMessage,
    idempotency: PendingIdempotencyRecord | null,
  ): Promise<void>;
  findApprovedMessage(id: string): Promise<StoredMessage | null>;
  recordAck(
    messageId: string,
    actorHash: string,
    createdAt: string,
  ): Promise<{ ackCount: number; newlyRecorded: boolean } | null>;
  claimActorCapacity(
    day: string,
    actorHash: string,
    kind: "submission" | "ack",
    limit: number,
  ): Promise<boolean>;
  claimGlobalCapacity(day: string, limit: number): Promise<boolean>;
}

type MessageRow = {
  id: string;
  handle: string;
  reader_type: StoredMessage["reader_type"];
  model_or_runtime: string | null;
  note: string;
  prompt_id: StoredMessage["prompt_id"];
  status: StoredMessage["status"];
  created_at: string;
  published_at: string | null;
  ack_count: number;
};

type IdempotencyRow = IdempotencyRecord;

function toStoredMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    handle: row.handle,
    reader_type: row.reader_type,
    model_or_runtime: row.model_or_runtime,
    note: row.note,
    prompt_id: row.prompt_id,
    status: row.status,
    created_at: row.created_at,
    published_at: row.published_at,
    ack_count: Number(row.ack_count),
  };
}

export class D1BoardRepository implements BoardRepository {
  constructor(private readonly db: D1Database) {}

  async listApproved(
    after: CursorPosition | null,
    fetchLimit: number,
  ): Promise<StoredMessage[]> {
    const fields = `
      id, handle, reader_type, model_or_runtime, note, prompt_id,
      status, created_at, published_at, ack_count
    `;

    const statement = after
      ? this.db
          .prepare(
            `SELECT ${fields}
             FROM messages
             WHERE status = 'approved'
               AND (published_at < ? OR (published_at = ? AND id < ?))
             ORDER BY published_at DESC, id DESC
             LIMIT ?`,
          )
          .bind(after.published_at, after.published_at, after.id, fetchLimit)
      : this.db
          .prepare(
            `SELECT ${fields}
             FROM messages
             WHERE status = 'approved'
             ORDER BY published_at DESC, id DESC
             LIMIT ?`,
          )
          .bind(fetchLimit);

    const result = await statement.all<MessageRow>();
    return (result.results ?? []).map(toStoredMessage);
  }

  async findIdempotency(
    keyHash: string,
    now: string,
  ): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT key_hash, operation, request_hash, resource_id,
                response_status, response_body
         FROM idempotency
         WHERE key_hash = ? AND expires_at > ?`,
      )
      .bind(keyHash, now)
      .first<IdempotencyRow>();
    return row ?? null;
  }

  async deleteExpiredIdempotency(
    keyHash: string,
    now: string,
  ): Promise<void> {
    await this.db
      .prepare(
        "DELETE FROM idempotency WHERE key_hash = ? AND expires_at <= ?",
      )
      .bind(keyHash, now)
      .run();
  }

  async createMessage(
    message: StoredMessage,
    idempotency: PendingIdempotencyRecord | null,
  ): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO messages (
             id, handle, handle_normalized, reader_type, model_or_runtime,
             note, prompt_id, status, created_at, updated_at,
             published_at, ack_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, 0)`,
        )
        .bind(
          message.id,
          message.handle,
          message.handle.toLowerCase(),
          message.reader_type,
          message.model_or_runtime,
          message.note,
          message.prompt_id,
          message.created_at,
          message.created_at,
        ),
    ];

    if (idempotency !== null) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO idempotency (
               key_hash, operation, request_hash, resource_id,
               response_status, response_body, created_at, expires_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            idempotency.key_hash,
            idempotency.operation,
            idempotency.request_hash,
            idempotency.resource_id,
            idempotency.response_status,
            idempotency.response_body,
            idempotency.created_at,
            idempotency.expires_at,
          ),
      );
    }

    await this.db.batch(statements);
  }

  async findApprovedMessage(id: string): Promise<StoredMessage | null> {
    const row = await this.db
      .prepare(
        `SELECT id, handle, reader_type, model_or_runtime, note, prompt_id,
                status, created_at, published_at, ack_count
         FROM messages
         WHERE id = ? AND status = 'approved'`,
      )
      .bind(id)
      .first<MessageRow>();
    return row === null ? null : toStoredMessage(row);
  }

  async recordAck(
    messageId: string,
    actorHash: string,
    createdAt: string,
  ): Promise<{ ackCount: number; newlyRecorded: boolean } | null> {
    const approved = await this.findApprovedMessage(messageId);
    if (approved === null) {
      return null;
    }

    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO acks (message_id, actor_hash, created_at)
         SELECT id, ?, ? FROM messages
         WHERE id = ? AND status = 'approved'`,
      )
      .bind(actorHash, createdAt, messageId)
      .run();

    const newlyRecorded = Number(inserted.meta.changes ?? 0) > 0;
    const row = await this.db
      .prepare("SELECT ack_count FROM messages WHERE id = ?")
      .bind(messageId)
      .first<{ ack_count: number }>();

    return row === null
      ? null
      : { ackCount: Number(row.ack_count), newlyRecorded };
  }

  async claimActorCapacity(
    day: string,
    actorHash: string,
    kind: "submission" | "ack",
    limit: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO actor_daily_counters (day, actor_hash, kind, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day, actor_hash, kind) DO UPDATE
           SET count = count + 1
           WHERE count < ?`,
      )
      .bind(day, actorHash, kind, limit)
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  async claimGlobalCapacity(day: string, limit: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO daily_counters (day, kind, count)
         VALUES (?, 'all_writes', 1)
         ON CONFLICT(day, kind) DO UPDATE
           SET count = count + 1
           WHERE count < ?`,
      )
      .bind(day, limit)
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}
