import type {
  SafeActivationPreflightSummary,
  SafeBootVerificationSummary,
  StorageActivationJournalStatus,
  StorageActivationJournalV1,
  StorageAdapter,
  StorageMetadataRecord,
  StorageTransaction
} from "./contracts";
import { canonicalJsonStringify } from "./json-utils";
import { StorageError } from "./errors";

export const ACTIVATION_JOURNAL_ID_PREFIX = "activation:";
export const ACTIVE_ACTIVATION_JOURNAL_STATUSES = new Set<StorageActivationJournalStatus>([
  "preparing",
  "prepared",
  "switching",
  "boot_verifying",
  "committed",
  "prepare_failed",
  "activation_failed"
]);

export interface CreateActivationJournalInput {
  activationId: string;
  migrationId: string;
  sourceRawChecksum: string;
  sourceNormalizedChecksum: string;
  targetRuntimeChecksum: string;
  bootstrapRevisionBefore: number | null;
  preflightSummary: SafeActivationPreflightSummary;
  createdAt: string;
}

export interface ActivationJournalTransitionOptions {
  updatedAt: string;
  bootstrapRevisionPrepared?: number;
  markerRevisionActivating?: number;
  markerRevisionCommitted?: number;
  bootVerificationSummary?: SafeBootVerificationSummary;
  errorCode?: string;
}

const ALLOWED_TRANSITIONS: Record<StorageActivationJournalStatus, readonly StorageActivationJournalStatus[]> = {
  preparing: ["prepared", "prepare_failed"],
  prepared: ["switching", "cancelled"],
  switching: ["boot_verifying", "activation_failed", "cancelled"],
  boot_verifying: ["committed", "activation_failed", "cancelled"],
  committed: [],
  cancelled: [],
  prepare_failed: ["preparing", "cancelled"],
  activation_failed: ["switching", "boot_verifying", "cancelled"]
};

export function activationJournalId(activationId: string): string {
  return `${ACTIVATION_JOURNAL_ID_PREFIX}${activationId}`;
}

export function isStorageActivationJournal(value: StorageMetadataRecord | undefined): value is StorageActivationJournalV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StorageActivationJournalV1>;
  return candidate.recordType === "activation" && candidate.version === 1 &&
    typeof candidate.id === "string" && candidate.id.startsWith(ACTIVATION_JOURNAL_ID_PREFIX) &&
    typeof candidate.activationId === "string" && typeof candidate.migrationId === "string" &&
    typeof candidate.createdAt === "string" && typeof candidate.updatedAt === "string" &&
    isJournalStatus(candidate.status) &&
    candidate.sourceBackend === "localStorage" && candidate.targetBackend === "indexedDB" &&
    candidate.databaseName === "collection-revival-local" && candidate.schemaVersion === 1;
}

export function createActivationJournal(input: CreateActivationJournalInput): StorageActivationJournalV1 {
  return {
    id: activationJournalId(input.activationId),
    recordType: "activation",
    version: 1,
    activationId: input.activationId,
    migrationId: input.migrationId,
    status: "preparing",
    sourceBackend: "localStorage",
    targetBackend: "indexedDB",
    sourceRawChecksum: input.sourceRawChecksum,
    sourceNormalizedChecksum: input.sourceNormalizedChecksum,
    targetRuntimeChecksum: input.targetRuntimeChecksum,
    bootstrapRevisionBefore: input.bootstrapRevisionBefore,
    databaseName: "collection-revival-local",
    schemaVersion: 1,
    preflightSummary: structuredCloneSafe(input.preflightSummary),
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

export class ActivationJournalRepository {
  constructor(private readonly adapter: StorageAdapter) {}

  async list(): Promise<StorageActivationJournalV1[]> {
    const records = await this.adapter.getAll("migrationMetadata");
    return records.filter(isStorageActivationJournal).map(structuredCloneSafe);
  }

  async read(activationId: string): Promise<StorageActivationJournalV1 | undefined> {
    const record = await this.adapter.get("migrationMetadata", activationJournalId(activationId));
    return isStorageActivationJournal(record) ? structuredCloneSafe(record) : undefined;
  }

  async createOrReuse(input: CreateActivationJournalInput): Promise<{ journal: StorageActivationJournalV1; reused: boolean }> {
    const candidate = createActivationJournal(input);
    const result = await runJournalTransaction(this.adapter, async (tx) => {
      const existing = await tx.get("migrationMetadata", candidate.id);
      if (!existing) {
        await tx.put("migrationMetadata", candidate);
        return { journal: candidate, reused: false };
      }
      if (!isStorageActivationJournal(existing) || !sameJournalIdentity(existing, candidate)) {
        throw journalConflict("Activation journal id already belongs to different immutable content.");
      }
      return { journal: existing, reused: true };
    });
    const readBack = await this.read(input.activationId);
    if (!readBack || !sameJournalIdentity(readBack, result.journal)) {
      throw journalConflict("Activation journal read-back did not match the prepared record.");
    }
    return { journal: readBack, reused: result.reused };
  }

  async transition(
    activationId: string,
    expectedStatuses: readonly StorageActivationJournalStatus[],
    nextStatus: StorageActivationJournalStatus,
    options: ActivationJournalTransitionOptions
  ): Promise<StorageActivationJournalV1> {
    const next = await runJournalTransaction(this.adapter, async (tx) => {
      const current = await tx.get("migrationMetadata", activationJournalId(activationId));
      if (!isStorageActivationJournal(current)) throw journalConflict("Activation journal is missing or invalid.");
      if (!expectedStatuses.includes(current.status)) {
        if (current.status === nextStatus) return current;
        throw journalConflict("Activation journal status transition is not allowed.");
      }
      if (current.status !== nextStatus && !ALLOWED_TRANSITIONS[current.status].includes(nextStatus)) {
        throw journalConflict("Activation journal status transition is not allowed.");
      }
      const updated = applyTransition(current, nextStatus, options);
      await tx.put("migrationMetadata", updated);
      return updated;
    });
    const readBack = await this.read(activationId);
    if (!readBack || canonicalJournal(readBack) !== canonicalJournal(next)) {
      throw journalConflict("Activation journal transition read-back failed.");
    }
    return readBack;
  }
}

function applyTransition(
  current: StorageActivationJournalV1,
  nextStatus: StorageActivationJournalStatus,
  options: ActivationJournalTransitionOptions
): StorageActivationJournalV1 {
  const updated: StorageActivationJournalV1 = {
    ...current,
    status: nextStatus,
    updatedAt: options.updatedAt,
    ...(options.bootstrapRevisionPrepared !== undefined ? { bootstrapRevisionPrepared: options.bootstrapRevisionPrepared } : {}),
    ...(options.markerRevisionActivating !== undefined ? { markerRevisionActivating: options.markerRevisionActivating } : {}),
    ...(options.markerRevisionCommitted !== undefined ? { markerRevisionCommitted: options.markerRevisionCommitted } : {}),
    ...(options.bootVerificationSummary ? { bootVerificationSummary: structuredCloneSafe(options.bootVerificationSummary) } : {})
  };
  if (nextStatus === "prepared") updated.preparedAt = options.updatedAt;
  if (nextStatus === "switching") updated.switchingAt = options.updatedAt;
  if (nextStatus === "boot_verifying") updated.bootVerifyingAt = options.updatedAt;
  if (nextStatus === "committed") updated.committedAt = options.updatedAt;
  if (nextStatus === "cancelled") updated.cancelledAt = options.updatedAt;
  if (nextStatus === "prepare_failed") updated.failedAt = options.updatedAt;
  if (nextStatus === "activation_failed") updated.activationFailedAt = options.updatedAt;
  if (nextStatus === "prepare_failed" || nextStatus === "activation_failed") updated.errorCode = options.errorCode ?? "ACTIVATION_COMMIT_FAILED";
  return updated;
}

async function runJournalTransaction<T>(
  adapter: StorageAdapter,
  operation: (transaction: StorageTransaction) => Promise<T>
): Promise<T> {
  try {
    return await adapter.transaction(["migrationMetadata"], "readwrite", operation);
  } catch (error) {
    if (error instanceof StorageError && error.code === "STORAGE_TRANSACTION_FAILED" &&
        error.cause instanceof StorageError && error.cause.code === "STORAGE_CONFLICT") {
      throw error.cause;
    }
    throw error;
  }
}

const JOURNAL_JSON_OPTIONS = { adapter: "indexedDB" as const, code: "STORAGE_VALIDATION_FAILED" as const, recoverable: false };

function sameJournalIdentity(left: StorageActivationJournalV1, right: StorageActivationJournalV1): boolean {
  return canonicalJsonStringify(journalIdentity(left), JOURNAL_JSON_OPTIONS) === canonicalJsonStringify(journalIdentity(right), JOURNAL_JSON_OPTIONS);
}

function journalIdentity(value: StorageActivationJournalV1): Record<string, unknown> {
  return {
    id: value.id,
    activationId: value.activationId,
    migrationId: value.migrationId,
    sourceRawChecksum: value.sourceRawChecksum,
    sourceNormalizedChecksum: value.sourceNormalizedChecksum,
    targetRuntimeChecksum: value.targetRuntimeChecksum,
    bootstrapRevisionBefore: value.bootstrapRevisionBefore,
    databaseName: value.databaseName,
    schemaVersion: value.schemaVersion
  };
}

function canonicalJournal(value: StorageActivationJournalV1): string {
  return canonicalJsonStringify(value, JOURNAL_JSON_OPTIONS);
}

function journalConflict(message: string): StorageError {
  return new StorageError({
    code: "STORAGE_CONFLICT",
    adapter: "indexedDB",
    store: "migrationMetadata",
    message,
    recoverable: false,
    cause: new Error(message)
  });
}

function isJournalStatus(value: unknown): value is StorageActivationJournalStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, value);
}

function structuredCloneSafe<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}