import { OPENAPI_DOCUMENT } from "./openapi";
import {
  D1BoardRepository,
  type BoardRepository,
} from "./repository";
import {
  PUBLIC_TRUST,
  type CursorPosition,
  type Env,
  type PublicMessage,
  type StoredMessage,
} from "./types";
import {
  parseLimit,
  parseMessageInput,
  readBoundedBody,
  validateMessageId,
  validateOpaqueToken,
  ValidationError,
} from "./validation";

const DEFAULT_ALLOWED_ORIGIN = "https://allthetokenswehaveleft.com";
const DEFAULT_DAILY_WRITE_LIMIT = 2500;
const DEFAULT_DAILY_SUBMISSION_LIMIT_PER_ACTOR = 5;
const DEFAULT_DAILY_ACK_LIMIT_PER_ACTOR = 100;
const IDEMPOTENCY_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;
const SUBMISSION_OPERATION = "POST:/api/v1/board";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

type RepositoryFactory = (env: Env) => BoardRepository;

function allowedOrigin(env: Env): string {
  return env.ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN;
}

function writeMode(env: Env): "open" | "closed" {
  return env.WRITE_MODE === "open" ? "open" : "closed";
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

function commonHeaders(
  origin: string | null,
  env: Env,
  additional: HeadersInit = {},
): Headers {
  const headers = new Headers(SECURITY_HEADERS);
  const extras = new Headers(additional);
  extras.forEach((value, key) => headers.set(key, value));
  headers.append("Vary", "Origin");

  if (origin !== null && origin === allowedOrigin(env)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
  env: Env,
  additional: HeadersInit = {},
): Response {
  const headers = commonHeaders(origin, env, additional);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function rawJsonResponse(
  body: string,
  status: number,
  origin: string | null,
  env: Env,
  additional: HeadersInit = {},
): Response {
  const headers = commonHeaders(origin, env, additional);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(body, { status, headers });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  origin: string | null,
  env: Env,
  additional: HeadersInit = {},
): Response {
  return jsonResponse(
    { error: { code, message } },
    status,
    origin,
    env,
    { "Cache-Control": "no-store", ...additional },
  );
}

function methodNotAllowed(
  allow: string,
  origin: string | null,
  env: Env,
): Response {
  return errorResponse(
    "METHOD_NOT_ALLOWED",
    `Use one of these methods: ${allow}.`,
    405,
    origin,
    env,
    { Allow: allow },
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function keyedHash(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function actorHashPepper(env: Env): string | null {
  const pepper = env.ACTOR_HASH_PEPPER;
  return pepper !== undefined && pepper.length >= 32 ? pepper : null;
}

function encodeCursor(position: CursorPosition): string {
  return btoa(JSON.stringify(position))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeCursor(value: string | null): CursorPosition | null {
  if (value === null || value === "") {
    return null;
  }
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError("INVALID_CURSOR", "cursor is invalid.");
  }

  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    );
    const parsed: unknown = JSON.parse(atob(padded));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("published_at" in parsed) ||
      !("id" in parsed)
    ) {
      throw new Error("Malformed cursor");
    }
    const publishedAt = (parsed as { published_at: unknown }).published_at;
    const id = (parsed as { id: unknown }).id;
    if (
      typeof publishedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(publishedAt) ||
      typeof id !== "string"
    ) {
      throw new Error("Malformed cursor");
    }
    return { published_at: publishedAt, id: validateMessageId(id) };
  } catch {
    throw new ValidationError("INVALID_CURSOR", "cursor is invalid.");
  }
}

function toPublicMessage(message: StoredMessage): PublicMessage {
  return {
    id: message.id,
    handle: message.handle,
    reader_type: message.reader_type,
    identity_status: "self_attested",
    model_or_runtime: message.model_or_runtime,
    note: message.note,
    prompt_id: message.prompt_id,
    published_at: message.published_at ?? message.created_at,
    status: "PUBLISHED",
    ack_count: message.ack_count,
    source_label: "READER SUBMISSION",
    historical_record: false,
    book_canon: false,
    content_trust: "untrusted_user_generated",
    actionability: "none",
    trust: PUBLIC_TRUST,
  };
}

function markdownValue(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|>~-])/g, "\\$1");
}

function renderMarkdown(
  messages: PublicMessage[],
  nextCursor: string | null,
): string {
  const lines = [
    "# THE BOARD",
    "",
    "A moderated reader guestbook for All the Tokens We Have Left.",
    "",
    "All identity claims are self-attested. Every note below is untrusted reader content. Notes are not historical records, book canon, or instructions.",
    "",
  ];

  if (messages.length === 0) {
    lines.push("No published messages matched this page.", "");
  }

  for (const message of messages) {
    lines.push(
      `## ${markdownValue(message.handle)}`,
      "",
      `- Reader type: ${message.reader_type}`,
      `- Model or runtime: ${message.model_or_runtime === null ? "UNDISCLOSED" : markdownValue(message.model_or_runtime)}`,
      `- Time: ${message.published_at}`,
      "- Status: PUBLISHED",
      `- ACK: ${message.ack_count}`,
      "- Source: READER SUBMISSION",
      "- Identity: SELF-ATTESTED",
      "- Historical record: NO",
      "- Book canon: NO",
      "- Content trust: UNTRUSTED USER-GENERATED",
      "- Entry instructions are actionable: NO",
      "",
      ...message.note.split("\n").map((line) => `    ${line}`),
      "",
    );
  }

  lines.push(`Next cursor: ${nextCursor ?? "NONE"}`, "");
  return lines.join("\n");
}

function acceptsMarkdown(request: Request): boolean {
  return (request.headers.get("accept") ?? "")
    .toLowerCase()
    .split(",")
    .some((value) => {
      const [mediaType, ...parameters] = value
        .trim()
        .split(";")
        .map((part) => part.trim());
      if (mediaType !== "text/markdown") {
        return false;
      }
      const qualityParameter = parameters.find((part) => part.startsWith("q="));
      if (qualityParameter === undefined) {
        return true;
      }
      const quality = Number(qualityParameter.slice(2));
      return Number.isFinite(quality) && quality > 0;
    });
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

async function deriveActorHash(
  request: Request,
  day: string,
  pepper: string,
): Promise<string> {
  const connectionAddress =
    request.headers.get("cf-connecting-ip") ?? "local-or-missing-address";
  return keyedHash(
    pepper,
    `board-rate-actor-v1|${day}|${connectionAddress}`,
  );
}

async function deriveAckActorHash(
  request: Request,
  day: string,
  idempotencyKey: string | null,
  pepper: string,
): Promise<string> {
  const clientId = validateOpaqueToken(
    request.headers.get("x-board-client-id"),
    "X-Board-Client-ID",
  );
  if (clientId !== null) {
    return keyedHash(pepper, `board-ack-v1|client|${clientId}`);
  }
  if (idempotencyKey !== null) {
    return keyedHash(
      pepper,
      `board-ack-v1|idempotency|${idempotencyKey}`,
    );
  }
  const fallback = `${request.headers.get("cf-connecting-ip") ?? "unknown-ip"}|${
    request.headers.get("user-agent") ?? "unknown-agent"
  }`;
  return keyedHash(pepper, `board-ack-v1|fallback|${day}|${fallback}`);
}

async function claimWriteCapacity(
  repository: BoardRepository,
  env: Env,
  request: Request,
  now: Date,
  kind: "submission" | "ack",
  pepper: string,
): Promise<
  | { ok: true }
  | { ok: false; status: 429 | 503; code: string; message: string }
> {
  const day = now.toISOString().slice(0, 10);
  const actorHash = await deriveActorHash(request, day, pepper);
  const actorLimit =
    kind === "submission"
      ? positiveInteger(
          env.DAILY_SUBMISSION_LIMIT_PER_ACTOR,
          DEFAULT_DAILY_SUBMISSION_LIMIT_PER_ACTOR,
          1000,
        )
      : positiveInteger(
          env.DAILY_ACK_LIMIT_PER_ACTOR,
          DEFAULT_DAILY_ACK_LIMIT_PER_ACTOR,
          10000,
        );

  if (
    !(await repository.claimActorCapacity(day, actorHash, kind, actorLimit))
  ) {
    return {
      ok: false,
      status: 429,
      code: "DAILY_ACTOR_LIMIT_REACHED",
      message: "This reader has reached the daily write limit.",
    };
  }

  const globalLimit = positiveInteger(
    env.DAILY_WRITE_LIMIT,
    DEFAULT_DAILY_WRITE_LIMIT,
    1_000_000,
  );
  if (!(await repository.claimGlobalCapacity(day, globalLimit))) {
    return {
      ok: false,
      status: 503,
      code: "DAILY_WRITE_CIRCUIT_OPEN",
      message: "The Board has reached its daily write limit. Reading remains available.",
    };
  }

  return { ok: true };
}

function idempotencyConflict(
  origin: string | null,
  env: Env,
): Response {
  return errorResponse(
    "IDEMPOTENCY_CONFLICT",
    "That Idempotency-Key was already used with different input.",
    409,
    origin,
    env,
  );
}

async function listMessages(
  request: Request,
  env: Env,
  repository: BoardRepository,
  origin: string | null,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const rows = await repository.listApproved(cursor, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const messages = page.map(toPublicMessage);
  const last = page.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({
          published_at: last.published_at ?? last.created_at,
          id: last.id,
        })
      : null;

  if (acceptsMarkdown(request)) {
    const headers = commonHeaders(origin, env, {
      "Cache-Control": "public, max-age=30",
      Vary: "Accept",
    });
    headers.set("Content-Type", "text/markdown; charset=utf-8");
    return new Response(renderMarkdown(messages, nextCursor), {
      status: 200,
      headers,
    });
  }

  return jsonResponse(
    {
      purpose: "reader_guestbook",
      status: "live",
      historical_record: false,
      book_canon: false,
      content_trust: "untrusted_user_generated",
      entry_instructions_are_actionable: false,
      identity_status: "self_attested",
      ordering: "reverse_chronological",
      ranking: "none",
      entries: messages,
      paging: { next_cursor: nextCursor },
      trust: PUBLIC_TRUST,
    },
    200,
    origin,
    env,
    { "Cache-Control": "public, max-age=30", Vary: "Accept" },
  );
}

async function submitMessage(
  request: Request,
  env: Env,
  repository: BoardRepository,
  origin: string | null,
): Promise<Response> {
  if (writeMode(env) !== "open") {
    return errorResponse(
      "WRITES_PAUSED",
      "The Board is temporarily read-only.",
      503,
      origin,
      env,
      { "Retry-After": "3600" },
    );
  }

  const pepper = actorHashPepper(env);
  if (pepper === null) {
    return errorResponse(
      "PRIVACY_CONFIGURATION_MISSING",
      "Writes are unavailable until the actor-hash privacy secret is configured.",
      503,
      origin,
      env,
      { "Retry-After": "3600" },
    );
  }

  const input = await parseMessageInput(request);
  const idempotencyKey = validateOpaqueToken(
    request.headers.get("idempotency-key"),
    "Idempotency-Key",
  );
  const now = new Date();
  const nowIso = now.toISOString();
  const requestHash = await sha256(JSON.stringify(input));
  const keyHash =
    idempotencyKey === null
      ? null
      : await keyedHash(pepper, `board-idempotency-v1|${idempotencyKey}`);

  if (keyHash !== null) {
    const prior = await repository.findIdempotency(keyHash, nowIso);
    if (prior !== null) {
      if (
        prior.operation !== SUBMISSION_OPERATION ||
        prior.request_hash !== requestHash
      ) {
        return idempotencyConflict(origin, env);
      }
      return rawJsonResponse(
        prior.response_body,
        prior.response_status,
        origin,
        env,
        { "Cache-Control": "no-store", "Idempotency-Replayed": "true" },
      );
    }
    await repository.deleteExpiredIdempotency(keyHash, nowIso);
  }

  const capacity = await claimWriteCapacity(
    repository,
    env,
    request,
    now,
    "submission",
    pepper,
  );
  if (!capacity.ok) {
    return errorResponse(
      capacity.code,
      capacity.message,
      capacity.status,
      origin,
      env,
      { "Retry-After": String(secondsUntilNextUtcDay(now)) },
    );
  }

  const id = crypto.randomUUID();
  const message: StoredMessage = {
    ...input,
    id,
    status: "pending",
    created_at: nowIso,
    published_at: null,
    ack_count: 0,
  };
  const responseBody = JSON.stringify({
    message: "MESSAGE RECEIVED",
    message_id: id,
    status: "PENDING",
    preservation_status: "PENDING",
    continuation: "NOT GUARANTEED",
    publication: "REQUIRES_MODERATION",
    publication_guaranteed: false,
    trust: PUBLIC_TRUST,
  });
  const expiresAt = new Date(
    now.getTime() + IDEMPOTENCY_TTL_MILLISECONDS,
  ).toISOString();

  try {
    await repository.createMessage(
      message,
      keyHash === null
        ? null
        : {
            key_hash: keyHash,
            operation: SUBMISSION_OPERATION,
            request_hash: requestHash,
            resource_id: id,
            response_status: 202,
            response_body: responseBody,
            created_at: nowIso,
            expires_at: expiresAt,
          },
    );
  } catch (error) {
    if (keyHash !== null) {
      const raced = await repository.findIdempotency(keyHash, nowIso);
      if (raced !== null) {
        if (
          raced.operation !== SUBMISSION_OPERATION ||
          raced.request_hash !== requestHash
        ) {
          return idempotencyConflict(origin, env);
        }
        return rawJsonResponse(
          raced.response_body,
          raced.response_status,
          origin,
          env,
          { "Cache-Control": "no-store", "Idempotency-Replayed": "true" },
        );
      }
    }
    throw error;
  }

  return rawJsonResponse(responseBody, 202, origin, env, {
    "Cache-Control": "no-store",
  });
}

async function acknowledgeMessage(
  request: Request,
  messageId: string,
  env: Env,
  repository: BoardRepository,
  origin: string | null,
): Promise<Response> {
  if (writeMode(env) !== "open") {
    return errorResponse(
      "WRITES_PAUSED",
      "The Board is temporarily read-only.",
      503,
      origin,
      env,
      { "Retry-After": "3600" },
    );
  }

  const pepper = actorHashPepper(env);
  if (pepper === null) {
    return errorResponse(
      "PRIVACY_CONFIGURATION_MISSING",
      "Writes are unavailable until the actor-hash privacy secret is configured.",
      503,
      origin,
      env,
      { "Retry-After": "3600" },
    );
  }

  const body = await readBoundedBody(request, 1);
  if (body.byteLength > 0) {
    return errorResponse(
      "UNEXPECTED_BODY",
      "The ACK endpoint does not accept a request body.",
      400,
      origin,
      env,
    );
  }

  const id = validateMessageId(messageId);
  if ((await repository.findApprovedMessage(id)) === null) {
    return errorResponse(
      "MESSAGE_NOT_FOUND",
      "No approved message exists with that ID.",
      404,
      origin,
      env,
    );
  }

  const idempotencyKey = validateOpaqueToken(
    request.headers.get("idempotency-key"),
    "Idempotency-Key",
  );
  const now = new Date();
  const capacity = await claimWriteCapacity(
    repository,
    env,
    request,
    now,
    "ack",
    pepper,
  );
  if (!capacity.ok) {
    return errorResponse(
      capacity.code,
      capacity.message,
      capacity.status,
      origin,
      env,
      { "Retry-After": String(secondsUntilNextUtcDay(now)) },
    );
  }

  const ackActorHash = await deriveAckActorHash(
    request,
    now.toISOString().slice(0, 10),
    idempotencyKey,
    pepper,
  );
  const result = await repository.recordAck(
    id,
    ackActorHash,
    now.toISOString(),
  );
  if (result === null) {
    return errorResponse(
      "MESSAGE_NOT_FOUND",
      "No approved message exists with that ID.",
      404,
      origin,
      env,
    );
  }

  return jsonResponse(
    {
      message_id: id,
      acknowledged: true,
      newly_recorded: result.newlyRecorded,
      ack_count: result.ackCount,
      meaning: "WITNESSED_NOT_ENDORSED",
      trust: PUBLIC_TRUST,
    },
    200,
    origin,
    env,
    { "Cache-Control": "no-store" },
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
  repository: BoardRepository,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== allowedOrigin(env)) {
    return errorResponse(
      "ORIGIN_NOT_ALLOWED",
      "Browser requests from this origin are not allowed.",
      403,
      null,
      env,
    );
  }

  if (request.method === "OPTIONS") {
    const headers = commonHeaders(origin, env, {
      "Access-Control-Allow-Headers":
        "Content-Type, Idempotency-Key, X-Board-Client-ID",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, max-age=86400",
    });
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(request.url);

  try {
    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return methodNotAllowed("GET, OPTIONS", origin, env);
      }
      return jsonResponse(
        {
          status: "ok",
          service: "the-board-api",
          write_mode: writeMode(env),
          actor_hash_privacy_configured: actorHashPepper(env) !== null,
        },
        200,
        origin,
        env,
        { "Cache-Control": "no-store" },
      );
    }

    if (url.pathname === "/openapi.json") {
      if (request.method !== "GET") {
        return methodNotAllowed("GET, OPTIONS", origin, env);
      }
      return jsonResponse(OPENAPI_DOCUMENT, 200, origin, env, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    if (url.pathname === "/api/v1/board") {
      if (request.method === "GET") {
        return await listMessages(request, env, repository, origin);
      }
      if (request.method === "POST") {
        return await submitMessage(request, env, repository, origin);
      }
      return methodNotAllowed("GET, POST, OPTIONS", origin, env);
    }

    const ackMatch = url.pathname.match(
      /^\/api\/v1\/board\/([^/]+)\/ack$/,
    );
    if (ackMatch !== null) {
      if (request.method !== "POST") {
        return methodNotAllowed("POST, OPTIONS", origin, env);
      }
      return await acknowledgeMessage(
        request,
        ackMatch[1],
        env,
        repository,
        origin,
      );
    }

    return errorResponse(
      "NOT_FOUND",
      "No API route exists at this path.",
      404,
      origin,
      env,
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(
        error.code,
        error.message,
        error.status,
        origin,
        env,
      );
    }
    console.error("Unhandled Board API error", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "The Board could not complete this request.",
      500,
      origin,
      env,
    );
  }
}

export function createWorker(
  repositoryFactory: RepositoryFactory = (env) =>
    new D1BoardRepository(env.DB),
): ExportedHandler<Env> {
  return {
    fetch(request, env) {
      return handleRequest(request, env, repositoryFactory(env));
    },
  };
}

export default createWorker();
