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
  | "RUNTIME_OPERATION_ABORTED"
  | "RUNTIME_TARGET_SCHEMA_MISMATCH"
  | "RUNTIME_REQUIRED_STORE_MISSING"
  | "RUNTIME_METADATA_MISSING"
  | "RUNTIME_METADATA_UNSUPPORTED"
  | "RUNTIME_ORDER_MANIFEST_MISSING"
  | "RUNTIME_ORDER_MANIFEST_INVALID"
  | "RUNTIME_ENTITY_REFERENCE_BROKEN"
  | "RUNTIME_HYDRATION_FAILED"
  | "RUNTIME_DEHYDRATION_FAILED"
  | "RUNTIME_TRANSACTION_FAILED"
  | "RUNTIME_VERIFICATION_FAILED"
  | "RUNTIME_ADAPTER_KIND_INVALID"
  | "RUNTIME_BASELINE_MISMATCH";

const SAFE_MESSAGES: Record<StorageRuntimeErrorCode, string> = {
  RUNTIME_NOT_OPEN: "Storage runtime is not open.",
  RUNTIME_ALREADY_CLOSED: "Storage runtime is already closed.",
  RUNTIME_UNAVAILABLE: "Storage runtime is unavailable.",
  RUNTIME_LOAD_FAILED: "Storage runtime could not load data.",
  RUNTIME_PERSIST_FAILED: "Storage runtime could not persist data.",
  RUNTIME_HEALTH_CHECK_FAILED: "Storage runtime health check failed.",
  RUNTIME_SCHEMA_UNSUPPORTED: "Storage runtime schema is unsupported.",
  RUNTIME_DATA_INVALID: "Storage runtime data is invalid.",
  RUNTIME_OPERATION_ABORTED: "Storage runtime operation was aborted.",
  RUNTIME_TARGET_SCHEMA_MISMATCH: "Storage runtime target schema does not match.",
  RUNTIME_REQUIRED_STORE_MISSING: "Storage runtime is missing a required store.",
  RUNTIME_METADATA_MISSING: "Storage runtime metadata is missing.",
  RUNTIME_METADATA_UNSUPPORTED: "Storage runtime metadata is unsupported.",
  RUNTIME_ORDER_MANIFEST_MISSING: "Storage runtime order metadata is missing.",
  RUNTIME_ORDER_MANIFEST_INVALID: "Storage runtime order metadata is invalid.",
  RUNTIME_ENTITY_REFERENCE_BROKEN: "Storage runtime contains an invalid entity reference.",
  RUNTIME_HYDRATION_FAILED: "Storage runtime could not hydrate application data.",
  RUNTIME_DEHYDRATION_FAILED: "Storage runtime could not dehydrate application data.",
  RUNTIME_TRANSACTION_FAILED: "Storage runtime transaction failed.",
  RUNTIME_VERIFICATION_FAILED: "Storage runtime write verification failed.",
  RUNTIME_ADAPTER_KIND_INVALID: "Storage runtime adapter kind is invalid.",
  RUNTIME_BASELINE_MISMATCH: "Storage runtime persistence baseline is stale."
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
