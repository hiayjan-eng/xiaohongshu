import type { StorageKind } from "./contracts";
import { StorageError, type StorageErrorCode } from "./errors";

export const DANGEROUS_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface JsonSafetyOptions {
  adapter: StorageKind;
  code?: StorageErrorCode;
  message?: string;
  recoverable?: boolean;
}

export function assertJsonSafe(value: unknown, options: JsonSafetyOptions, seen = new WeakSet<object>()): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throwJsonSafetyError(options, "Storage records must use finite numbers.");
    }
    return;
  }
  if (kind === "undefined" || kind === "function" || kind === "symbol" || kind === "bigint") {
    throwJsonSafetyError(options, options.message ?? "Storage records must be JSON-safe.");
  }
  if (kind !== "object") {
    throwJsonSafetyError(options, options.message ?? "Storage records must be JSON-safe.");
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throwJsonSafetyError(options, "Storage records cannot contain circular references.");
  }
  seen.add(objectValue);

  if (Array.isArray(value)) {
    value.forEach((entry) => assertJsonSafe(entry, options, seen));
    seen.delete(objectValue);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throwJsonSafetyError(options, "Storage records must be plain JSON objects.");
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_JSON_KEYS.has(key)) {
      throwJsonSafetyError(options, "Storage records contain a blocked key.");
    }
    assertJsonSafe((value as Record<string, unknown>)[key], options, seen);
  }
  seen.delete(objectValue);
}

export function cloneJsonSafe<T>(value: T, options: JsonSafetyOptions): T {
  assertJsonSafe(value, options);
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function assertNoDangerousJsonKeys(value: unknown, options: JsonSafetyOptions, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  const objectValue = value as object;
  if (seen.has(objectValue)) return;
  seen.add(objectValue);

  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoDangerousJsonKeys(entry, options, seen));
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_JSON_KEYS.has(key)) {
      throwJsonSafetyError(options, "JSON payload contains a blocked key.");
    }
    assertNoDangerousJsonKeys((value as Record<string, unknown>)[key], options, seen);
  }
}

export function canonicalJsonStringify(value: unknown, options: JsonSafetyOptions): string {
  const canonical = canonicalizeJson(value, options);
  return JSON.stringify(canonical);
}

export function canonicalizeJson(value: unknown, options: JsonSafetyOptions, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throwJsonSafetyError(options, "Canonical JSON only supports finite numbers.");
    }
    return value;
  }
  if (kind === "undefined") return undefined;
  if (kind === "function" || kind === "symbol" || kind === "bigint") {
    throwJsonSafetyError(options, "Canonical JSON cannot serialize functions, symbols, or bigint values.");
  }
  if (kind !== "object") {
    throwJsonSafetyError(options, "Canonical JSON received an unsupported value.");
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throwJsonSafetyError(options, "Canonical JSON cannot serialize circular references.");
  }
  seen.add(objectValue);

  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      throwJsonSafetyError(options, "Canonical JSON cannot serialize an invalid Date.");
    }
    seen.delete(objectValue);
    return value.toISOString();
  }

  if (value instanceof Set) {
    const entries = Array.from(value.values()).map((entry) => canonicalizeJson(entry, options, seen));
    seen.delete(objectValue);
    return entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([key, entry]) => [
      canonicalizeJson(key, options, seen),
      canonicalizeJson(entry, options, seen)
    ]);
    seen.delete(objectValue);
    return entries.sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  }

  if (Array.isArray(value)) {
    const entries = value.map((entry) => {
      const canonicalEntry = canonicalizeJson(entry, options, seen);
      return canonicalEntry === undefined ? null : canonicalEntry;
    });
    seen.delete(objectValue);
    return entries;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throwJsonSafetyError(options, "Canonical JSON only supports plain objects.");
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (DANGEROUS_JSON_KEYS.has(key)) {
      throwJsonSafetyError(options, "Canonical JSON payload contains a blocked key.");
    }
    const canonicalEntry = canonicalizeJson((value as Record<string, unknown>)[key], options, seen);
    if (canonicalEntry !== undefined) {
      result[key] = canonicalEntry;
    }
  }
  seen.delete(objectValue);
  return result;
}

function throwJsonSafetyError(options: JsonSafetyOptions, message: string): never {
  throw new StorageError({
    adapter: options.adapter,
    code: options.code ?? "STORAGE_VALIDATION_FAILED",
    message,
    recoverable: options.recoverable ?? true
  });
}
