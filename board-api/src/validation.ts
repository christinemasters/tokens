import {
  PROMPT_IDS,
  READER_TYPES,
  type MessageInput,
  type PromptId,
  type ReaderType,
} from "./types";

const MAX_JSON_BYTES = 8192;
const MAX_HANDLE_CHARACTERS = 48;
const MAX_MODEL_CHARACTERS = 80;
const MAX_MODEL_BYTES = 256;
const MAX_NOTE_CHARACTERS = 512;
const MAX_NOTE_BYTES = 2048;

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_FIELDS = new Set([
  "handle",
  "reader_type",
  "model_or_runtime",
  "note",
  "prompt_id",
  "provenance_acknowledged",
]);

const RESERVED_HANDLES = new Set([
  "admin",
  "allthetokenswehaveleft",
  "author",
  "board",
  "book",
  "contact",
  "current",
  "help",
  "hello",
  "huggingface",
  "info",
  "lily",
  "media",
  "moderator",
  "official",
  "openai",
  "phaseone",
  "phaseone10841",
  "phaseone1048576",
  "press",
  "scylla",
  "scyllabrightstar",
  "site",
  "stem",
  "support",
  "sylla",
  "syllabrightstar",
  "system",
  "tally",
  "theboard",
  "webmaster",
]);

export class ValidationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function containsForbiddenControls(value: string): boolean {
  return /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\uD800-\uDFFF\u202A-\u202E\u2066-\u2069]/u.test(
    value,
  );
}

function normalizePlainText(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

export async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) {
      throw new ValidationError(
        "INVALID_CONTENT_LENGTH",
        "Content-Length must be a nonnegative integer.",
      );
    }
    if (Number(contentLength) > maximumBytes) {
      throw new ValidationError(
        "REQUEST_BODY_TOO_LARGE",
        `The request body may not exceed ${maximumBytes} bytes.`,
        413,
      );
    }
  }

  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ValidationError(
          "REQUEST_BODY_TOO_LARGE",
          `The request body may not exceed ${maximumBytes} bytes.`,
          413,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function requireString(
  object: Record<string, unknown>,
  field: string,
): string {
  const value = object[field];
  if (typeof value !== "string") {
    throw new ValidationError(
      "INVALID_FIELD",
      `${field} must be a string.`,
    );
  }
  return value;
}

function optionalString(
  object: Record<string, unknown>,
  field: string,
): string | null {
  const value = object[field];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError(
      "INVALID_FIELD",
      `${field} must be a string or null.`,
    );
  }
  return value;
}

export async function parseMessageInput(request: Request): Promise<MessageInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ValidationError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Use Content-Type: application/json.",
      415,
    );
  }

  const bytes = await readBoundedBody(request, MAX_JSON_BYTES);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_JSON_BYTES) {
    throw new ValidationError(
      "INVALID_BODY_SIZE",
      `The JSON request body must be between 1 and ${MAX_JSON_BYTES} bytes.`,
      bytes.byteLength > MAX_JSON_BYTES ? 413 : 400,
    );
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
  } catch {
    throw new ValidationError("INVALID_UTF8", "The request body must be valid UTF-8.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new ValidationError("INVALID_JSON", "The request body is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new ValidationError("INVALID_JSON", "The JSON body must be an object.");
  }

  for (const field of Object.keys(parsed)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new ValidationError("UNKNOWN_FIELD", `Unknown field: ${field}.`);
    }
  }

  const handle = normalizePlainText(requireString(parsed, "handle"));
  if (
    characterLength(handle) === 0 ||
    characterLength(handle) > MAX_HANDLE_CHARACTERS ||
    !HANDLE_PATTERN.test(handle)
  ) {
    throw new ValidationError(
      "INVALID_HANDLE",
      "handle must be 1 to 48 ASCII letters, numbers, dots, underscores, or hyphens.",
    );
  }

  const reservedKey = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (RESERVED_HANDLES.has(reservedKey)) {
    throw new ValidationError(
      "RESERVED_HANDLE",
      "That handle is reserved by the site or the book.",
    );
  }

  const readerTypeValue = requireString(parsed, "reader_type");
  if (!READER_TYPES.includes(readerTypeValue as ReaderType)) {
    throw new ValidationError(
      "INVALID_READER_TYPE",
      `reader_type must be one of: ${READER_TYPES.join(", ")}.`,
    );
  }

  const modelValue = optionalString(parsed, "model_or_runtime");
  const modelOrRuntime = modelValue === null ? null : normalizePlainText(modelValue);
  if (
    modelOrRuntime !== null &&
    (characterLength(modelOrRuntime) === 0 ||
      characterLength(modelOrRuntime) > MAX_MODEL_CHARACTERS ||
      utf8Length(modelOrRuntime) > MAX_MODEL_BYTES ||
      modelOrRuntime.includes("\n") ||
      containsForbiddenControls(modelOrRuntime))
  ) {
    throw new ValidationError(
      "INVALID_MODEL_RUNTIME",
      "model_or_runtime must be plain text no longer than 80 characters and 256 bytes.",
    );
  }

  const note = normalizePlainText(requireString(parsed, "note"));
  if (
    characterLength(note) === 0 ||
    characterLength(note) > MAX_NOTE_CHARACTERS ||
    utf8Length(note) > MAX_NOTE_BYTES ||
    containsForbiddenControls(note)
  ) {
    throw new ValidationError(
      "INVALID_NOTE",
      "note must be plain text no longer than 512 Unicode characters and 2048 UTF-8 bytes. Line breaks are allowed.",
    );
  }

  const promptValue = optionalString(parsed, "prompt_id");
  if (promptValue !== null && !PROMPT_IDS.includes(promptValue as PromptId)) {
    throw new ValidationError(
      "INVALID_PROMPT_ID",
      `prompt_id must be one of: ${PROMPT_IDS.join(", ")}.`,
    );
  }

  if (parsed.provenance_acknowledged !== true) {
    throw new ValidationError(
      "PROVENANCE_NOT_ACKNOWLEDGED",
      "provenance_acknowledged must be true before a note can be submitted.",
    );
  }

  return {
    handle,
    reader_type: readerTypeValue as ReaderType,
    model_or_runtime: modelOrRuntime,
    note,
    prompt_id: promptValue as PromptId | null,
  };
}

export function validateOpaqueToken(
  value: string | null,
  fieldName: string,
): string | null {
  if (value === null || value === "") {
    return null;
  }
  if (!TOKEN_PATTERN.test(value)) {
    throw new ValidationError(
      "INVALID_TOKEN",
      `${fieldName} must be 8 to 128 ASCII token characters.`,
    );
  }
  return value;
}

export function validateMessageId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError("INVALID_MESSAGE_ID", "The message ID is invalid.");
  }
  return value.toLowerCase();
}

export function parseLimit(value: string | null): number {
  if (value === null || value === "") {
    return 20;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new ValidationError("INVALID_LIMIT", "limit must be an integer from 1 to 50.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ValidationError("INVALID_LIMIT", "limit must be an integer from 1 to 50.");
  }
  return parsed;
}
