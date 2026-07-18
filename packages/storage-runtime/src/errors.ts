import type { StorageRuntimeKind, StorageRuntimeLifecycle } from "./contracts";

export type StorageRuntimeErrorCode =
  | "RUNTIME_NOT_OPEN"
  | "RUNTIME_ALREADY_CLOSED"
  | "RUNTIME_UNAVAILABLE"
  | "RUNTIME_LOAD_FAILED"
  | "RUNTIME_PERSIST_FAILED"
  | "RUNTIME_HEALTH_CHECK_FAILED"
  | "RUNTIME_SCHEMA_UNSUPPORTED"
  | "RUNTIME_DATA_INVALID"
  | "RUNTIME_OPERATION_ABORTED";

const SAFE_MESSAGES: Record<StorageRuntimeErrorCode, string> = {
  RUNTIME_NOT_OPEN: "Storage runtime is not open.",
  RUNTIME_ALREADY_CLOSED: "Storage runtime is already closed.",
  RUNTIME_UNAVAILABLE: "Storage runtime is unavailable.",
  RUNTIME_LOAD_FAILED: "Storage runtime could not load data.",
  RUNTIME_PERSIST_FAILED: "Storage runtime could not persist data.",
  RUNTIME_HEALTH_CHECK_FAILED: "Storage runtime health check failed.",
  RUNTIME_SCHEMA_UNSUPPORTED: "Storage runtime schema is unsupported.",
  RUNTIME_DATA_INVALID: "Storage runtime data is invalid.",
  RUNTIME_OPERATION_ABORTED: "Storage runtime operation was aborted."
};

export class StorageRuntimeError extends Error {
  readonly code: StorageRuntimeErrorCode;
  readonly runtimeKind: StorageRuntimeKind;
  readonly lifecycle: StorageRuntimeLifecycle;
  readonly recoverable: boolean;
  readonly cause?: unknown;

  constructor(options: {
    code: StorageRuntimeErrorCode;
    runtimeKind: StorageRuntimeKind;
    lifecycle: StorageRuntimeLifecycle;
    recoverable: boolean;
    cause?: unknown;
  }) {
    super(SAFE_MESSAGES[options.code]);
    this.name = "StorageRuntimeError";
    this.code = options.code;
    this.runtimeKind = options.runtimeKind;
    this.lifecycle = options.lifecycle;
    this.recoverable = options.recoverable;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toSafeJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      runtimeKind: this.runtimeKind,
      lifecycle: this.lifecycle,
      recoverable: this.recoverable,
      message: this.message
    };
  }
}
