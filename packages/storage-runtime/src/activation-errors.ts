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
  | "ACTIVATION_CANCEL_NOT_ALLOWED";

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
  ACTIVATION_CANCEL_NOT_ALLOWED: "Activation prepare cannot be cancelled safely."
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