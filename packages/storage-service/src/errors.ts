import type { StorageEntityName, StorageKind } from "./contracts";

export const STORAGE_ERROR_CODES = [
  "STORAGE_UNAVAILABLE",
  "STORAGE_OPEN_FAILED",
  "STORAGE_CLOSE_FAILED",
  "STORAGE_READ_FAILED",
  "STORAGE_WRITE_FAILED",
  "STORAGE_DELETE_FAILED",
  "STORAGE_CLEAR_FAILED",
  "STORAGE_TRANSACTION_FAILED",
  "STORAGE_QUOTA_EXCEEDED",
  "STORAGE_SCHEMA_MISMATCH",
  "STORAGE_VALIDATION_FAILED",
  "STORAGE_SNAPSHOT_INVALID",
  "STORAGE_EXPORT_FAILED",
  "STORAGE_IMPORT_FAILED",
  "STORAGE_ROLLBACK_FAILED",
  "STORAGE_LOCKED",
  "STORAGE_CONFLICT",
  "STORAGE_NOT_SUPPORTED",
  "STORAGE_RECORD_NOT_FOUND",
  "STORAGE_DUPLICATE_KEY"
] as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

export interface StorageErrorOptions {
  code: StorageErrorCode;
  adapter: StorageKind;
  message: string;
  store?: StorageEntityName;
  recoverable?: boolean;
  cause?: unknown;
}

export interface SerializedStorageError {
  name: "StorageError";
  code: StorageErrorCode;
  adapter: StorageKind;
  store?: StorageEntityName;
  recoverable: boolean;
  message: string;
}

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly adapter: StorageKind;
  readonly store?: StorageEntityName;
  readonly recoverable: boolean;
  override readonly cause?: unknown;

  constructor(options: StorageErrorOptions) {
    super(sanitizeStorageErrorMessage(options.message));
    this.name = "StorageError";
    this.code = options.code;
    this.adapter = options.adapter;
    this.store = options.store;
    this.recoverable = options.recoverable ?? false;
    if ("cause" in options) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: false
      });
    }
  }

  toJSON(): SerializedStorageError {
    return {
      name: "StorageError",
      code: this.code,
      adapter: this.adapter,
      store: this.store,
      recoverable: this.recoverable,
      message: this.message
    };
  }
}

export function sanitizeStorageErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/(xsec_token|token|access_token|api[_-]?key|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

export function createStorageNotSupportedError(adapter: StorageKind, operation: string, store?: StorageEntityName): StorageError {
  return new StorageError({
    adapter,
    code: "STORAGE_NOT_SUPPORTED",
    message: `${operation} is not supported by ${adapter} adapter in the current Phase 1 contract.`,
    recoverable: true,
    store
  });
}
