import type { StorageEntityName, StorageKind, StoragePrimaryKey } from "./contracts";

export type MigrationExecutionErrorCode =
  | "MIGRATION_ALREADY_ACTIVATED"
  | "MIGRATION_BACKUP_INVALID"
  | "MIGRATION_CANCELLED"
  | "MIGRATION_CHECKPOINT_INVALID"
  | "MIGRATION_LOCK_UNAVAILABLE"
  | "MIGRATION_LOCK_TIMEOUT"
  | "MIGRATION_NOT_FOUND"
  | "MIGRATION_PLAN_MISMATCH"
  | "MIGRATION_PREVIEW_BLOCKED"
  | "MIGRATION_RESUME_CONFLICT"
  | "MIGRATION_ROLLBACK_FAILED"
  | "MIGRATION_SOURCE_MISMATCH"
  | "MIGRATION_TARGET_NOT_EMPTY"
  | "MIGRATION_TARGET_UNAVAILABLE"
  | "MIGRATION_UNSUPPORTED_TARGET"
  | "MIGRATION_USER_CONFIRMATION_REQUIRED"
  | "MIGRATION_VERIFY_FAILED"
  | "MIGRATION_WRITE_FAILED";

export interface MigrationExecutionErrorInput {
  code: MigrationExecutionErrorCode;
  message: string;
  recoverable: boolean;
  store?: StorageEntityName;
  recordId?: StoragePrimaryKey;
  adapter?: StorageKind;
  cause?: unknown;
}

export class MigrationExecutionError extends Error {
  readonly code: MigrationExecutionErrorCode;
  readonly recoverable: boolean;
  readonly store?: StorageEntityName;
  readonly recordId?: StoragePrimaryKey;
  readonly adapter?: StorageKind;
  readonly cause?: unknown;

  constructor(input: MigrationExecutionErrorInput) {
    super(sanitizeMigrationExecutionMessage(input.message));
    this.name = "MigrationExecutionError";
    this.code = input.code;
    this.recoverable = input.recoverable;
    this.store = input.store;
    this.recordId = input.recordId;
    this.adapter = input.adapter;
    this.cause = input.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      store: this.store,
      recordId: this.recordId,
      adapter: this.adapter
    };
  }
}

export function toMigrationExecutionError(
  error: unknown,
  fallback: Omit<MigrationExecutionErrorInput, "message"> & { message?: string }
): MigrationExecutionError {
  if (error instanceof MigrationExecutionError) return error;
  const message = error instanceof Error ? error.message : fallback.message ?? "Migration execution failed.";
  return new MigrationExecutionError({
    ...fallback,
    message,
    cause: error
  });
}

export function sanitizeMigrationExecutionMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/(xsec_token|token|access_token|api[_-]?key|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/userNote["']?\s*:\s*["'][^"']+["']/gi, "userNote:[redacted]")
    .slice(0, 240);
}
