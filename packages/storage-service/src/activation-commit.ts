import type { JsonValue, SafeBootVerificationSummary, StorageActivationJournalV1, StorageAdapter, StoredSetting } from "./contracts";
import { activationJournalId, isStorageActivationJournal } from "./activation-journal";
import { metadataId, type MigrationExecutionMetadataRecord } from "./migration-executor";
import { canonicalJsonStringify } from "./json-utils";
import { StorageError } from "./errors";

export const RUNTIME_ACTIVATION_METADATA_KEY = "runtime:activation:v1";

export interface RuntimeActivationMetadataValue {
  recordType: "runtime-activation";
  version: 1;
  activationId: string;
  migrationId: string;
  activatedAt: string;
}

export interface CommitActivationInput {
  activationId: string;
  migrationId: string;
  committedAt: string;
  markerRevisionCommitted: number;
  bootVerificationSummary: SafeBootVerificationSummary;
}

export interface CommitActivationResult {
  metadata: MigrationExecutionMetadataRecord;
  journal: StorageActivationJournalV1;
  runtimeSetting: StoredSetting;
  idempotent: boolean;
}

export class ActivationCommitRepository {
  constructor(private readonly adapter: StorageAdapter) {}

  async commit(input: CommitActivationInput): Promise<CommitActivationResult> {
    const result = await this.adapter.transaction(["migrationMetadata", "settings"], "readwrite", async (tx) => {
      const metadataRecord = await tx.get("migrationMetadata", metadataId(input.migrationId));
      const journalRecord = await tx.get("migrationMetadata", activationJournalId(input.activationId));
      if (!isMigrationMetadata(metadataRecord) || !isStorageActivationJournal(journalRecord)) {
        throw conflict("Activation commit evidence is missing.");
      }
      if (journalRecord.migrationId !== input.migrationId) throw conflict("Activation commit ids do not match.");
      if (metadataRecord.activeStorageSwitched || journalRecord.status === "committed") {
        if (metadataRecord.activeStorageSwitched && journalRecord.status === "committed" &&
            metadataRecord.activationId === input.activationId) {
          const setting = await tx.get("settings", RUNTIME_ACTIVATION_METADATA_KEY);
          if (!setting) throw conflict("Committed activation runtime metadata is missing.");
          return { metadata: metadataRecord, journal: journalRecord, runtimeSetting: setting, idempotent: true };
        }
        throw conflict("Activation commit evidence is inconsistent.");
      }
      if (metadataRecord.executionStatus !== "completed" || journalRecord.status !== "boot_verifying") {
        throw conflict("Activation is not ready to commit.");
      }
      const metadata: MigrationExecutionMetadataRecord = {
        ...metadataRecord,
        activeStorageSwitched: true,
        activeStorageSwitchedAt: input.committedAt,
        activationId: input.activationId,
        rollbackAvailable: false
      };
      const journal: StorageActivationJournalV1 = {
        ...journalRecord,
        status: "committed",
        committedAt: input.committedAt,
        updatedAt: input.committedAt,
        markerRevisionCommitted: input.markerRevisionCommitted,
        bootVerificationSummary: clone(input.bootVerificationSummary)
      };
      const runtimeSetting: StoredSetting = {
        id: `setting-${RUNTIME_ACTIVATION_METADATA_KEY}`,
        key: RUNTIME_ACTIVATION_METADATA_KEY,
        value: {
          recordType: "runtime-activation",
          version: 1,
          activationId: input.activationId,
          migrationId: input.migrationId,
          activatedAt: input.committedAt
        } as JsonValue,
        category: "internal",
        internal: true,
        updatedAt: input.committedAt,
        schemaVersion: 1
      };
      await tx.put("migrationMetadata", metadata);
      await tx.put("migrationMetadata", journal);
      await tx.put("settings", runtimeSetting);
      return { metadata, journal, runtimeSetting, idempotent: false };
    });

    const [metadataRead, journalRead, settingRead] = await Promise.all([
      this.adapter.get("migrationMetadata", metadataId(input.migrationId)),
      this.adapter.get("migrationMetadata", activationJournalId(input.activationId)),
      this.adapter.get("settings", RUNTIME_ACTIVATION_METADATA_KEY)
    ]);
    if (!isMigrationMetadata(metadataRead) || !isStorageActivationJournal(journalRead) || !settingRead ||
        canonical(metadataRead) !== canonical(result.metadata) || canonical(journalRead) !== canonical(result.journal) ||
        canonical(settingRead) !== canonical(result.runtimeSetting)) {
      throw conflict("Activation commit read-back did not match.");
    }
    return { metadata: metadataRead, journal: journalRead, runtimeSetting: settingRead, idempotent: result.idempotent };
  }
}

export function parseRuntimeActivationMetadata(setting: StoredSetting | undefined): RuntimeActivationMetadataValue | undefined {
  const value = setting?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.recordType !== "runtime-activation" || candidate.version !== 1 ||
      typeof candidate.activationId !== "string" || typeof candidate.migrationId !== "string" ||
      typeof candidate.activatedAt !== "string" || Number.isNaN(Date.parse(candidate.activatedAt))) return undefined;
  return {
    recordType: "runtime-activation",
    version: 1,
    activationId: candidate.activationId,
    migrationId: candidate.migrationId,
    activatedAt: candidate.activatedAt
  };
}

function isMigrationMetadata(value: unknown): value is MigrationExecutionMetadataRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MigrationExecutionMetadataRecord>;
  return typeof candidate.id === "string" && candidate.id.startsWith("migration-execution:") &&
    typeof candidate.executionStatus === "string" && typeof candidate.activeStorageSwitched === "boolean";
}

const JSON_OPTIONS = { adapter: "indexedDB" as const, code: "STORAGE_VALIDATION_FAILED" as const, recoverable: false };
function canonical(value: unknown): string { return canonicalJsonStringify(value, JSON_OPTIONS); }
function clone<T>(value: T): T { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T; }
function conflict(message: string): StorageError {
  return new StorageError({ code: "STORAGE_CONFLICT", adapter: "indexedDB", store: "migrationMetadata", message, recoverable: false });
}