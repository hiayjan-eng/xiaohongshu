export type ActivationErrorCode =
  | "ACTIVATION_PREFLIGHT_FAILED"
  | "ACTIVATION_SOURCE_DRIFT"
  | "ACTIVATION_TARGET_NOT_EQUIVALENT"
  | "ACTIVATION_BACKUP_INVALID"
  | "ACTIVATION_MIGRATION_NOT_COMPLETED"
  | "ACTIVATION_ALREADY_PREPARED"
  | "ACTIVATION_CONFLICT"
  | "ACTIVATION_MARKER_INVALID"
  | "ACTIVATION_MARKER_VERSION_UNSUPPORTED"
  | "ACTIVATION_MARKER_REVISION_CONFLICT"
  | "ACTIVATION_JOURNAL_MISSING"
  | "ACTIVATION_JOURNAL_CONFLICT"
  | "ACTIVATION_MULTIPLE_ACTIVE_JOURNALS"
  | "ACTIVATION_CAPABILITY_UNAVAILABLE"
  | "ACTIVATION_WRITE_GATE_FAILED"
  | "ACTIVATION_PREPARE_FAILED"
  | "ACTIVATION_CANCEL_NOT_ALLOWED"
  | "ACTIVATION_CONFIRMATION_REQUIRED"
  | "ACTIVATION_FINAL_RECHECK_FAILED"
  | "ACTIVATION_SWITCH_JOURNAL_FAILED"
  | "ACTIVATION_MARKER_SWITCH_FAILED"
  | "ACTIVATION_RELOAD_REQUIRED"
  | "ACTIVATION_BOOT_OPEN_FAILED"
  | "ACTIVATION_BOOT_HEALTH_FAILED"
  | "ACTIVATION_BOOT_HYDRATE_FAILED"
  | "ACTIVATION_BOOT_VERIFICATION_FAILED"
  | "ACTIVATION_COMMIT_FAILED"
  | "ACTIVATION_MARKER_FINALIZE_FAILED"
  | "ACTIVATION_ALREADY_COMMITTED"
  | "ACTIVATION_CANCEL_AFTER_COMMIT_FORBIDDEN"
  | "ACTIVATION_BACKEND_CONFLICT"
  | "ACTIVATION_RUNTIME_SELECTION_FAILED"
  | "ACTIVATION_OLD_TAB_WRITE_BLOCKED"
  | "RECOVERY_RETRY_FAILED"
  | "RECOVERY_MARKER_REPAIR_FAILED"
  | "RECOVERY_EXPORT_FAILED";

const SAFE_ACTIVATION_MESSAGES: Record<ActivationErrorCode, string> = {
  ACTIVATION_PREFLIGHT_FAILED: "Activation preflight did not pass.",
  ACTIVATION_SOURCE_DRIFT: "Legacy source changed after migration.",
  ACTIVATION_TARGET_NOT_EQUIVALENT: "Target runtime is not equivalent to the legacy source.",
  ACTIVATION_BACKUP_INVALID: "Migration backup verification failed.",
  ACTIVATION_MIGRATION_NOT_COMPLETED: "Migration is not completed and inactive.",
  ACTIVATION_ALREADY_PREPARED: "Activation is already prepared.",
  ACTIVATION_CONFLICT: "Activation state conflicts with another operation.",
  ACTIVATION_MARKER_INVALID: "Storage bootstrap marker is invalid.",
  ACTIVATION_MARKER_VERSION_UNSUPPORTED: "Storage bootstrap marker version is unsupported.",
  ACTIVATION_MARKER_REVISION_CONFLICT: "Storage bootstrap marker revision changed.",
  ACTIVATION_JOURNAL_MISSING: "Activation journal is missing.",
  ACTIVATION_JOURNAL_CONFLICT: "Activation journal conflicts with the bootstrap marker.",
  ACTIVATION_MULTIPLE_ACTIVE_JOURNALS: "Multiple unresolved activation journals exist.",
  ACTIVATION_CAPABILITY_UNAVAILABLE: "Required browser capability is unavailable.",
  ACTIVATION_WRITE_GATE_FAILED: "Runtime writes could not be frozen safely.",
  ACTIVATION_PREPARE_FAILED: "Activation prepare failed.",
  ACTIVATION_CANCEL_NOT_ALLOWED: "Activation prepare cannot be cancelled safely.",
  ACTIVATION_CONFIRMATION_REQUIRED: "All activation confirmations are required.",
  ACTIVATION_FINAL_RECHECK_FAILED: "The final activation verification did not pass.",
  ACTIVATION_SWITCH_JOURNAL_FAILED: "The activation switching journal could not be recorded.",
  ACTIVATION_MARKER_SWITCH_FAILED: "The activating bootstrap marker could not be recorded.",
  ACTIVATION_RELOAD_REQUIRED: "A controlled reload is required to continue activation.",
  ACTIVATION_BOOT_OPEN_FAILED: "IndexedDB could not be opened during activation boot.",
  ACTIVATION_BOOT_HEALTH_FAILED: "IndexedDB health verification failed during activation boot.",
  ACTIVATION_BOOT_HYDRATE_FAILED: "IndexedDB data could not be hydrated during activation boot.",
  ACTIVATION_BOOT_VERIFICATION_FAILED: "IndexedDB activation boot verification failed.",
  ACTIVATION_COMMIT_FAILED: "IndexedDB activation commit failed.",
  ACTIVATION_MARKER_FINALIZE_FAILED: "The final bootstrap marker could not be recorded.",
  ACTIVATION_ALREADY_COMMITTED: "IndexedDB activation is already committed.",
  ACTIVATION_CANCEL_AFTER_COMMIT_FORBIDDEN: "Committed activation cannot be cancelled to legacy storage.",
  ACTIVATION_BACKEND_CONFLICT: "Storage backend evidence is inconsistent.",
  ACTIVATION_RUNTIME_SELECTION_FAILED: "The authoritative storage runtime could not be selected safely.",
  ACTIVATION_OLD_TAB_WRITE_BLOCKED: "This page can no longer write through the legacy runtime.",
  RECOVERY_RETRY_FAILED: "Storage recovery retry did not complete.",
  RECOVERY_MARKER_REPAIR_FAILED: "The bootstrap marker could not be finalized safely.",
  RECOVERY_EXPORT_FAILED: "The safe recovery export could not be created."
};

export class ActivationError extends Error {
  readonly code: ActivationErrorCode;
  readonly blocking: boolean;
  readonly recoverable: boolean;
  readonly cause?: unknown;

  constructor(options: { code: ActivationErrorCode; blocking?: boolean; recoverable: boolean; cause?: unknown }) {
    super(SAFE_ACTIVATION_MESSAGES[options.code]);
    this.name = "ActivationError";
    this.code = options.code;
    this.blocking = options.blocking ?? true;
    this.recoverable = options.recoverable;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toSafeJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, blocking: this.blocking, recoverable: this.recoverable, message: this.message };
  }
}