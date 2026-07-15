import {
  STORAGE_ENTITY_NAMES,
  type MigrationMetadata,
  type StorageAdapter,
  type StorageBackup,
  type StorageBulkWriteResult,
  type StorageEntityName,
  type StorageKind,
  type StoragePrimaryKey,
  type StorageRecordMap,
  type StorageSnapshot
} from "./contracts";
import { StorageError } from "./errors";
import { canonicalJsonStringify, cloneJsonSafe } from "./json-utils";
import type { LegacyBackupEnvelope } from "./legacy-localstorage-snapshot";
import { MemoryMigrationLockProvider, type MigrationLockHandle, type MigrationLockProvider } from "./migration-lock";
import type { MigrationPlan, MigrationPreviewReport, MigrationRecordOperation } from "./migration-preview";
import { createMemoryAdapter, getRecordPrimaryKey } from "./memory-adapter";
import { MigrationExecutionError, type MigrationExecutionErrorCode, toMigrationExecutionError } from "./migration-executor-errors";

export type MigrationExecutionStatus =
  | "not_started"
  | "lock_acquiring"
  | "preflight"
  | "backup_persisted"
  | "writing_store"
  | "verifying_store"
  | "verifying_all"
  | "completed"
  | "failed"
  | "cancelled"
  | "rollback_pending"
  | "rolled_back"
  | "rollback_failed";

export type MigrationStoreCheckpointStatus =
  | "pending"
  | "writing"
  | "written"
  | "verified"
  | "failed"
  | "rolled_back";

export interface MigrationStoreCheckpoint {
  store: StorageEntityName;
  status: MigrationStoreCheckpointStatus;
  expectedCount: number;
  writtenCount: number;
  verifiedCount: number;
  expectedChecksum?: string;
  targetChecksum?: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: MigrationExecutionErrorCode;
}

export interface MigrationExecutionProgress {
  migrationId: string;
  status: MigrationExecutionStatus;
  currentStore?: StorageEntityName;
  completedStores: number;
  totalStores: number;
  writtenCounts: Partial<Record<StorageEntityName, number>>;
  verifiedCounts: Partial<Record<StorageEntityName, number>>;
  updatedAt: string;
}

export interface MigrationExecutionResult {
  migrationId: string;
  status: "completed" | "failed" | "cancelled" | "rolled_back";
  targetStorage: StorageKind;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  rolledBackAt?: string;
  backupId: string;
  backupRecordId?: string;
  checkpoints: MigrationStoreCheckpoint[];
  writtenCounts: Partial<Record<StorageEntityName, number>>;
  verifiedCounts: Partial<Record<StorageEntityName, number>>;
  expectedChecksums: Partial<Record<StorageEntityName, string>>;
  targetChecksums: Partial<Record<StorageEntityName, string>>;
  rollbackAvailable: boolean;
  activeStorageSwitched: false;
  resumed: boolean;
  resumeCount: number;
  idempotent: boolean;
  warnings: string[];
}

export interface MigrationExecutionInspection {
  found: boolean;
  migrationId: string;
  metadata?: MigrationExecutionMetadataRecord;
  checkpoints: MigrationStoreCheckpoint[];
  canResume: boolean;
  canRollback: boolean;
  status?: MigrationExecutionStatus;
}

export interface MigrationExecutionOptions {
  targetAdapter: StorageAdapter;
  lockProvider?: MigrationLockProvider;
  now?: () => Date;
  onProgress?: (progress: MigrationExecutionProgress) => void;
  faultInjector?: MigrationExecutionFaultInjector;
}

export interface MigrationExecutionInput {
  envelope: LegacyBackupEnvelope;
  preview: MigrationPreviewReport;
  plan?: MigrationPlan;
  userConfirmed: boolean;
  signal?: AbortSignal;
}

export interface MigrationResumeInput extends MigrationExecutionInput {
  migrationId: string;
}

export interface MigrationRollbackInput {
  migrationId: string;
  signal?: AbortSignal;
}

export interface MigrationExecutionFaultInjector {
  afterPersistBackup?: (context: MigrationFaultContext) => Promise<void> | void;
  beforeStoreWrite?: (context: MigrationFaultContext & { store: StorageEntityName }) => Promise<void> | void;
  afterStoreWrite?: (context: MigrationFaultContext & { store: StorageEntityName }) => Promise<void> | void;
  beforeStoreVerify?: (context: MigrationFaultContext & { store: StorageEntityName }) => Promise<void> | void;
  beforeFinalVerify?: (context: MigrationFaultContext) => Promise<void> | void;
  beforeRollbackStore?: (context: MigrationFaultContext & { store: StorageEntityName }) => Promise<void> | void;
}

export interface MigrationFaultContext {
  migrationId: string;
  phase: MigrationExecutionStatus;
}

export interface MigrationExecutionMetadataRecord extends MigrationMetadata {
  executionStatus: MigrationExecutionStatus;
  previewId: string;
  backupRecordId?: string;
  sourceSnapshotChecksum?: string;
  activeStorageSwitched: false;
  rollbackAvailable: boolean;
  resumeCount: number;
  checkpoints: MigrationStoreCheckpoint[];
  writtenCounts: Partial<Record<StorageEntityName, number>>;
  verifiedCounts: Partial<Record<StorageEntityName, number>>;
  expectedChecksums: Partial<Record<StorageEntityName, string>>;
  targetChecksums: Partial<Record<StorageEntityName, string>>;
  lastCheckpointAt?: string;
  idempotent?: boolean;
}

export const MIGRATION_EXECUTION_STORE_ORDER: readonly StorageEntityName[] = [
  "settings",
  "savedItems",
  "importBatches",
  "importBatchItems",
  "smartAlbums",
  "actionCards",
  "planCards",
  "classificationCorrections",
  "searchLogs"
];

const EXECUTION_METADATA_ID_PREFIX = "migration-execution:";
const BACKUP_RECORD_ID_PREFIX = "legacy-backup:";
const SKIPPED_EXECUTION_STORES = new Set<StorageEntityName>(["migrationMetadata", "backups"]);

export class MigrationExecutor {
  private readonly targetAdapter: StorageAdapter;
  private readonly lockProvider: MigrationLockProvider;
  private readonly now: () => Date;
  private readonly onProgress?: (progress: MigrationExecutionProgress) => void;
  private readonly faultInjector?: MigrationExecutionFaultInjector;

  constructor(options: MigrationExecutionOptions) {
    this.targetAdapter = options.targetAdapter;
    this.lockProvider = options.lockProvider ?? new MemoryMigrationLockProvider();
    this.now = options.now ?? (() => new Date());
    this.onProgress = options.onProgress;
    this.faultInjector = options.faultInjector;
  }

  async execute(input: MigrationExecutionInput): Promise<MigrationExecutionResult> {
    const plan = input.plan ?? input.preview.plan;
    const migrationId = plan.migrationId;
    let lock: MigrationLockHandle | undefined;
    try {
      this.assertNotAborted(input.signal);
      lock = await this.acquireLock(migrationId, input.signal);
      await this.ensureTargetReady();
      const existing = await this.readMetadata(migrationId);
      if (existing?.executionStatus === "completed") {
        await this.verifyAllStores(input.envelope.normalizedSnapshot, existing);
        return this.toResult(existing, "completed", true);
      }
      this.validateInitialInput(input);
      await this.assertTargetEmpty(plan);
      await this.validateStagingSnapshot(input.envelope.normalizedSnapshot!, plan);

      const startedAt = this.isoNow();
      let metadata = this.createInitialMetadata(input, startedAt);
      await this.writeMetadata(metadata);
      this.emitProgress(metadata, "preflight");

      metadata = await this.persistBackup(input.envelope, metadata);
      await this.faultInjector?.afterPersistBackup?.({ migrationId, phase: "backup_persisted" });
      metadata = await this.writeStores(input.envelope.normalizedSnapshot!, plan, metadata, input.signal);
      metadata = await this.verifyFinal(input.envelope.normalizedSnapshot!, metadata);
      metadata = this.completeMetadata(metadata);
      await this.writeMetadata(metadata);
      return this.toResult(metadata, "completed", false);
    } catch (error) {
      const converted = toMigrationExecutionError(error, {
        code: input.signal?.aborted ? "MIGRATION_CANCELLED" : "MIGRATION_WRITE_FAILED",
        recoverable: true,
        adapter: this.targetAdapter.kind
      });
      await this.tryMarkFailed(migrationId, converted, input.signal?.aborted ? "cancelled" : "failed");
      throw converted;
    } finally {
      await lock?.release();
    }
  }

  async resume(input: MigrationResumeInput): Promise<MigrationExecutionResult> {
    const plan = input.plan ?? input.preview.plan;
    let lock: MigrationLockHandle | undefined;
    try {
      this.assertNotAborted(input.signal);
      lock = await this.acquireLock(input.migrationId, input.signal);
      await this.ensureTargetReady();
      this.validateInitialInput(input);
      await this.validateStagingSnapshot(input.envelope.normalizedSnapshot!, plan);
      let metadata = await this.readMetadataOrThrow(input.migrationId);
      if (metadata.executionStatus === "completed") {
        await this.verifyAllStores(input.envelope.normalizedSnapshot, metadata);
        return this.toResult(metadata, "completed", true);
      }
      if (metadata.executionStatus === "rolled_back") {
        throw new MigrationExecutionError({
          code: "MIGRATION_RESUME_CONFLICT",
          message: "Rolled back migrations cannot be resumed.",
          recoverable: false
        });
      }
      this.assertPlanMatchesMetadata(plan, metadata);
      metadata = {
        ...metadata,
        status: "migrating",
        executionStatus: "preflight",
        resumeCount: metadata.resumeCount + 1,
        lastCheckpointAt: this.isoNow()
      };
      await this.writeMetadata(metadata);

      metadata = await this.reconcileCheckpoints(input.envelope.normalizedSnapshot!, metadata);
      metadata = await this.writeStores(input.envelope.normalizedSnapshot!, plan, metadata, input.signal);
      metadata = await this.verifyFinal(input.envelope.normalizedSnapshot!, metadata);
      metadata = this.completeMetadata(metadata);
      await this.writeMetadata(metadata);
      return this.toResult(metadata, "completed", false);
    } catch (error) {
      const converted = toMigrationExecutionError(error, {
        code: input.signal?.aborted ? "MIGRATION_CANCELLED" : "MIGRATION_WRITE_FAILED",
        recoverable: true,
        adapter: this.targetAdapter.kind
      });
      await this.tryMarkFailed(input.migrationId, converted, input.signal?.aborted ? "cancelled" : "failed");
      throw converted;
    } finally {
      await lock?.release();
    }
  }

  async rollback(input: MigrationRollbackInput): Promise<MigrationExecutionResult> {
    let lock: MigrationLockHandle | undefined;
    try {
      this.assertNotAborted(input.signal);
      lock = await this.acquireLock(input.migrationId, input.signal);
      await this.ensureTargetReady();
      let metadata = await this.readMetadataOrThrow(input.migrationId);
      if (metadata.executionStatus === "rolled_back") {
        return this.toResult(metadata, "rolled_back", true);
      }
      if (metadata.activeStorageSwitched) {
        throw new MigrationExecutionError({
          code: "MIGRATION_ALREADY_ACTIVATED",
          message: "Migration rollback is blocked after activeStorage has switched.",
          recoverable: false
        });
      }

      metadata = {
        ...metadata,
        status: "failed",
        executionStatus: "rollback_pending",
        lastCheckpointAt: this.isoNow()
      };
      await this.writeMetadata(metadata);

      for (const store of [...this.executionStores(metadata)].reverse()) {
        this.assertNotAborted(input.signal);
        await this.faultInjector?.beforeRollbackStore?.({ migrationId: input.migrationId, phase: "rollback_pending", store });
        await this.targetAdapter.transaction([store], "readwrite", async (tx) => {
          await tx.clear(store);
        });
        metadata = this.updateCheckpoint(metadata, store, {
          status: "rolled_back",
          writtenCount: 0,
          verifiedCount: 0,
          targetChecksum: undefined,
          completedAt: this.isoNow()
        });
        await this.writeMetadata(metadata);
      }

      metadata = {
        ...metadata,
        status: "rolled_back",
        executionStatus: "rolled_back",
        rolledBackAt: this.isoNow(),
        rollbackAvailable: false,
        lastCheckpointAt: this.isoNow()
      };
      await this.writeMetadata(metadata);
      return this.toResult(metadata, "rolled_back", false);
    } catch (error) {
      const converted = toMigrationExecutionError(error, {
        code: "MIGRATION_ROLLBACK_FAILED",
        recoverable: true,
        adapter: this.targetAdapter.kind
      });
      await this.tryMarkRollbackFailed(input.migrationId, converted);
      throw converted;
    } finally {
      await lock?.release();
    }
  }

  async inspect(migrationId: string): Promise<MigrationExecutionInspection> {
    await this.ensureTargetReady();
    const metadata = await this.readMetadata(migrationId);
    if (!metadata) {
      return {
        found: false,
        migrationId,
        checkpoints: [],
        canResume: false,
        canRollback: false
      };
    }
    return {
      found: true,
      migrationId,
      metadata,
      checkpoints: metadata.checkpoints,
      canResume: ["failed", "cancelled", "writing_store", "verifying_store", "backup_persisted", "preflight"].includes(metadata.executionStatus),
      canRollback: metadata.rollbackAvailable && !metadata.activeStorageSwitched && metadata.executionStatus !== "rolled_back",
      status: metadata.executionStatus
    };
  }

  private async acquireLock(migrationId: string, signal?: AbortSignal): Promise<MigrationLockHandle> {
    this.emitProgressFromValues(migrationId, "lock_acquiring", {}, {});
    return this.lockProvider.acquire({ migrationId, signal });
  }

  private async ensureTargetReady(): Promise<void> {
    if (this.targetAdapter.kind !== "indexedDB" && this.targetAdapter.kind !== "memory") {
      throw new MigrationExecutionError({
        code: "MIGRATION_UNSUPPORTED_TARGET",
        message: "Migration execution only supports indexedDB or memory test adapters.",
        recoverable: false,
        adapter: this.targetAdapter.kind
      });
    }
    const available = await this.targetAdapter.isAvailable();
    if (!available) {
      throw new MigrationExecutionError({
        code: "MIGRATION_TARGET_UNAVAILABLE",
        message: "Target storage adapter is unavailable.",
        recoverable: true,
        adapter: this.targetAdapter.kind
      });
    }
    await this.targetAdapter.open();
    const health = await this.targetAdapter.healthCheck();
    if (!health.opened) {
      throw new MigrationExecutionError({
        code: "MIGRATION_TARGET_UNAVAILABLE",
        message: "Target storage adapter did not open successfully.",
        recoverable: true,
        adapter: this.targetAdapter.kind
      });
    }
  }

  private validateInitialInput(input: MigrationExecutionInput): void {
    const plan = input.plan ?? input.preview.plan;
    if (!input.userConfirmed) {
      throw new MigrationExecutionError({
        code: "MIGRATION_USER_CONFIRMATION_REQUIRED",
        message: "Migration execution requires explicit user confirmation.",
        recoverable: true
      });
    }
    if (input.preview.migrationId !== plan.migrationId) {
      throw new MigrationExecutionError({
        code: "MIGRATION_PLAN_MISMATCH",
        message: "Migration preview and plan ids do not match.",
        recoverable: false
      });
    }
    if (plan.sourceBackupId !== input.envelope.backupId) {
      throw new MigrationExecutionError({
        code: "MIGRATION_SOURCE_MISMATCH",
        message: "Migration plan does not match the provided backup envelope.",
        recoverable: false
      });
    }
    if (!input.envelope.normalizedSnapshot) {
      throw new MigrationExecutionError({
        code: "MIGRATION_BACKUP_INVALID",
        message: "Migration execution requires a normalized StorageSnapshot.",
        recoverable: true
      });
    }
    const envelopeChecksum = input.envelope.checksums?.normalized ?? input.envelope.normalizedSnapshot.checksum;
    if (plan.sourceSnapshotChecksum && envelopeChecksum && plan.sourceSnapshotChecksum !== envelopeChecksum) {
      throw new MigrationExecutionError({
        code: "MIGRATION_SOURCE_MISMATCH",
        message: "Migration plan checksum does not match the normalized Snapshot.",
        recoverable: false
      });
    }
    if (!plan.executable || !input.preview.summary.canProceed || plan.blockingIssueIds.length > 0) {
      throw new MigrationExecutionError({
        code: "MIGRATION_PREVIEW_BLOCKED",
        message: "Migration preview contains blocking issues and cannot be executed.",
        recoverable: true
      });
    }
    for (const planStore of Object.values(plan.storePlans)) {
      for (const operation of planStore?.operations ?? []) {
        if (operation.operation === "conflict" || operation.operation === "manual_review") {
          throw new MigrationExecutionError({
            code: "MIGRATION_PREVIEW_BLOCKED",
            message: "Migration plan still contains unresolved conflict or manual-review operations.",
            recoverable: true,
            store: operation.store,
            recordId: operation.recordId
          });
        }
      }
    }
  }

  private async assertTargetEmpty(plan: MigrationPlan): Promise<void> {
    if (!plan.targetMustBeEmpty) return;
    for (const store of this.executionStoresFromPlan(plan)) {
      const records = await this.targetAdapter.getAll(store, { limit: 1 });
      if (records.length > 0) {
        throw new MigrationExecutionError({
          code: "MIGRATION_TARGET_NOT_EMPTY",
          message: `Target store ${store} already contains data.`,
          recoverable: true,
          store,
          adapter: this.targetAdapter.kind
        });
      }
    }
  }

  private async validateStagingSnapshot(snapshot: StorageSnapshot | undefined, plan: MigrationPlan): Promise<void> {
    if (!snapshot) return;
    const staging = createMemoryAdapter({ schemaVersion: plan.targetSchemaVersion });
    await staging.open();
    const stores = this.executionStoresFromPlan(plan);
    await staging.importSnapshot(snapshot, { mode: "staging", stores });
  }

  private createInitialMetadata(input: MigrationExecutionInput, startedAt: string): MigrationExecutionMetadataRecord {
    const plan = input.plan ?? input.preview.plan;
    const snapshot = input.envelope.normalizedSnapshot!;
    const checkpoints = this.executionStoresFromPlan(plan).map((store) => {
      const records = recordsForStore(store, snapshot, plan);
      return {
        store,
        status: "pending" as const,
        expectedCount: records.length,
        writtenCount: 0,
        verifiedCount: 0,
        expectedChecksum: computeStoreChecksum(store, records)
      };
    });

    return {
      id: metadataId(plan.migrationId),
      sourceStorage: "localStorage",
      targetStorage: this.targetAdapter.kind,
      sourceSchemaVersion: plan.sourceSchemaVersion,
      targetSchemaVersion: plan.targetSchemaVersion,
      status: "migrating",
      executionStatus: "preflight",
      previewId: input.preview.migrationId,
      startedAt,
      backupId: input.envelope.backupId,
      sourceSnapshotChecksum: plan.sourceSnapshotChecksum,
      activeStorageSwitched: false,
      rollbackAvailable: true,
      resumeCount: 0,
      checkpoints,
      writtenCounts: {},
      verifiedCounts: {},
      expectedChecksums: Object.fromEntries(checkpoints.map((checkpoint) => [checkpoint.store, checkpoint.expectedChecksum])) as Partial<Record<StorageEntityName, string>>,
      targetChecksums: {},
      warnings: input.preview.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code),
      lastCheckpointAt: startedAt
    };
  }

  private async persistBackup(envelope: LegacyBackupEnvelope, metadata: MigrationExecutionMetadataRecord): Promise<MigrationExecutionMetadataRecord> {
    const snapshot = envelope.normalizedSnapshot;
    if (!snapshot) {
      throw new MigrationExecutionError({
        code: "MIGRATION_BACKUP_INVALID",
        message: "Cannot persist a migration backup without normalized Snapshot.",
        recoverable: true
      });
    }
    const backupRecordId = `${BACKUP_RECORD_ID_PREFIX}${envelope.backupId}`;
    const backup: StorageBackup & Record<string, unknown> = {
      id: backupRecordId,
      sourceStorage: "localStorage",
      sourceSchemaVersion: snapshot.sourceSchemaVersion,
      createdAt: envelope.createdAt,
      checksum: envelope.checksums?.raw ?? envelope.checksums?.normalized ?? snapshot.checksum,
      formatVersion: envelope.formatVersion,
      snapshot,
      notes: "Legacy raw backup is preserved inside this migration backup envelope for rollback inspection.",
      rawBackup: envelope.rawBackup,
      checksums: envelope.checksums,
      report: envelope.report
    };

    await this.targetAdapter.transaction(["backups", "migrationMetadata"], "readwrite", async (tx) => {
      await tx.put("backups", backup as StorageRecordMap["backups"]);
      await tx.put("migrationMetadata", {
        ...metadata,
        status: "migrating",
        executionStatus: "backup_persisted",
        backupRecordId,
        lastCheckpointAt: this.isoNow()
      } as StorageRecordMap["migrationMetadata"]);
    });

    const updated = {
      ...metadata,
      executionStatus: "backup_persisted" as const,
      backupRecordId,
      lastCheckpointAt: this.isoNow()
    };
    this.emitProgress(updated, "backup_persisted");
    return updated;
  }

  private async writeStores(
    snapshot: StorageSnapshot,
    plan: MigrationPlan,
    metadata: MigrationExecutionMetadataRecord,
    signal?: AbortSignal
  ): Promise<MigrationExecutionMetadataRecord> {
    let current = metadata;
    for (const store of this.executionStoresFromPlan(plan)) {
      this.assertNotAborted(signal);
      const checkpoint = current.checkpoints.find((entry) => entry.store === store);
      if (checkpoint?.status === "verified") continue;
      if (checkpoint && checkpoint.status !== "pending" && checkpoint.status !== "failed" && checkpoint.status !== "writing" && checkpoint.status !== "written") {
        continue;
      }

      const records = recordsForStore(store, snapshot, plan);
      current = this.updateCheckpoint(current, store, {
        status: "writing",
        startedAt: checkpoint?.startedAt ?? this.isoNow(),
        errorCode: undefined
      });
      current = { ...current, executionStatus: "writing_store", status: "migrating", lastCheckpointAt: this.isoNow() };
      await this.writeMetadata(current);
      this.emitProgress(current, "writing_store", store);
      await this.faultInjector?.beforeStoreWrite?.({ migrationId: plan.migrationId, phase: "writing_store", store });

      await this.targetAdapter.transaction([store], "readwrite", async (tx) => {
        if (records.length > 0) {
          const result = await tx.bulkPut(store, records as never);
          assertBulkWriteSucceeded(store, result, records.length);
        }
      });

      await this.faultInjector?.afterStoreWrite?.({ migrationId: plan.migrationId, phase: "writing_store", store });
      current = this.updateCheckpoint(current, store, {
        status: "written",
        writtenCount: records.length,
        completedAt: this.isoNow()
      });
      current.writtenCounts = { ...current.writtenCounts, [store]: records.length };
      await this.writeMetadata(current);

      current = await this.verifyStore(snapshot, plan, current, store);
    }
    return current;
  }

  private async verifyStore(
    snapshot: StorageSnapshot,
    plan: MigrationPlan,
    metadata: MigrationExecutionMetadataRecord,
    store: StorageEntityName
  ): Promise<MigrationExecutionMetadataRecord> {
    let current = {
      ...metadata,
      status: "verifying" as const,
      executionStatus: "verifying_store" as const,
      lastCheckpointAt: this.isoNow()
    };
    await this.writeMetadata(current);
    this.emitProgress(current, "verifying_store", store);
    await this.faultInjector?.beforeStoreVerify?.({ migrationId: plan.migrationId, phase: "verifying_store", store });

    const expectedRecords = recordsForStore(store, snapshot, plan);
    const targetRecords = await this.targetAdapter.getAll(store);
    const expectedChecksum = computeStoreChecksum(store, expectedRecords);
    const targetChecksum = computeStoreChecksum(store, targetRecords as never);
    if (targetRecords.length !== expectedRecords.length || targetChecksum !== expectedChecksum) {
      throw new MigrationExecutionError({
        code: "MIGRATION_VERIFY_FAILED",
        message: `Target store ${store} did not match the migration plan after writing.`,
        recoverable: true,
        store,
        adapter: this.targetAdapter.kind
      });
    }
    current = this.updateCheckpoint(current, store, {
      status: "verified",
      expectedCount: expectedRecords.length,
      writtenCount: expectedRecords.length,
      verifiedCount: targetRecords.length,
      expectedChecksum,
      targetChecksum,
      completedAt: this.isoNow()
    });
    current.verifiedCounts = { ...current.verifiedCounts, [store]: targetRecords.length };
    current.targetChecksums = { ...current.targetChecksums, [store]: targetChecksum };
    await this.writeMetadata(current);
    return current;
  }

  private async verifyFinal(snapshot: StorageSnapshot, metadata: MigrationExecutionMetadataRecord): Promise<MigrationExecutionMetadataRecord> {
    await this.faultInjector?.beforeFinalVerify?.({ migrationId: metadata.id.replace(EXECUTION_METADATA_ID_PREFIX, ""), phase: "verifying_all" });
    let current = {
      ...metadata,
      status: "verifying" as const,
      executionStatus: "verifying_all" as const,
      lastCheckpointAt: this.isoNow()
    };
    await this.writeMetadata(current);
    this.emitProgress(current, "verifying_all");
    await this.verifyAllStores(snapshot, current);
    return current;
  }

  private async verifyAllStores(snapshot: StorageSnapshot | undefined, metadata: MigrationExecutionMetadataRecord): Promise<void> {
    if (!snapshot) {
      throw new MigrationExecutionError({
        code: "MIGRATION_BACKUP_INVALID",
        message: "Cannot verify migration without normalized Snapshot.",
        recoverable: true
      });
    }
    for (const checkpoint of metadata.checkpoints) {
      const expected = (snapshot.records[checkpoint.store] ?? []) as StorageRecordMap[typeof checkpoint.store][];
      const targetRecords = await this.targetAdapter.getAll(checkpoint.store);
      const expectedChecksum = checkpoint.expectedChecksum ?? computeStoreChecksum(checkpoint.store, expected);
      const targetChecksum = computeStoreChecksum(checkpoint.store, targetRecords as never);
      if (targetRecords.length !== checkpoint.expectedCount || targetChecksum !== expectedChecksum) {
        throw new MigrationExecutionError({
          code: "MIGRATION_VERIFY_FAILED",
          message: `Final verification failed for ${checkpoint.store}.`,
          recoverable: true,
          store: checkpoint.store,
          adapter: this.targetAdapter.kind
        });
      }
    }
  }

  private async reconcileCheckpoints(snapshot: StorageSnapshot, metadata: MigrationExecutionMetadataRecord): Promise<MigrationExecutionMetadataRecord> {
    let current = metadata;
    for (const checkpoint of metadata.checkpoints) {
      if (checkpoint.status === "verified") {
        const records = await this.targetAdapter.getAll(checkpoint.store);
        const checksum = computeStoreChecksum(checkpoint.store, records as never);
        if (records.length !== checkpoint.expectedCount || checksum !== checkpoint.expectedChecksum) {
          throw new MigrationExecutionError({
            code: "MIGRATION_RESUME_CONFLICT",
            message: `Verified checkpoint for ${checkpoint.store} no longer matches target storage.`,
            recoverable: false,
            store: checkpoint.store
          });
        }
        continue;
      }
      const existing = await this.targetAdapter.getAll(checkpoint.store);
      if (existing.length === 0) {
        current = this.updateCheckpoint(current, checkpoint.store, { status: "pending", writtenCount: 0, verifiedCount: 0 });
        continue;
      }
      const expected = (snapshot.records[checkpoint.store] ?? []) as StorageRecordMap[typeof checkpoint.store][];
      const existingChecksum = computeStoreChecksum(checkpoint.store, existing as never);
      const expectedChecksum = computeStoreChecksum(checkpoint.store, expected);
      if (existing.length === expected.length && existingChecksum === expectedChecksum) {
        current = this.updateCheckpoint(current, checkpoint.store, {
          status: "verified",
          writtenCount: existing.length,
          verifiedCount: existing.length,
          targetChecksum: existingChecksum,
          completedAt: this.isoNow()
        });
        continue;
      }
      throw new MigrationExecutionError({
        code: "MIGRATION_RESUME_CONFLICT",
        message: `Target store ${checkpoint.store} contains data that does not match the checkpoint.`,
        recoverable: false,
        store: checkpoint.store
      });
    }
    await this.writeMetadata(current);
    return current;
  }

  private completeMetadata(metadata: MigrationExecutionMetadataRecord): MigrationExecutionMetadataRecord {
    const completedAt = this.isoNow();
    const completed = {
      ...metadata,
      status: "completed" as const,
      executionStatus: "completed" as const,
      completedAt,
      rollbackAvailable: true,
      lastCheckpointAt: completedAt
    };
    this.emitProgress(completed, "completed");
    return completed;
  }

  private updateCheckpoint(
    metadata: MigrationExecutionMetadataRecord,
    store: StorageEntityName,
    patch: Partial<MigrationStoreCheckpoint>
  ): MigrationExecutionMetadataRecord {
    return {
      ...metadata,
      checkpoints: metadata.checkpoints.map((checkpoint) =>
        checkpoint.store === store ? { ...checkpoint, ...patch } : checkpoint
      ),
      lastCheckpointAt: this.isoNow()
    };
  }

  private async tryMarkFailed(migrationId: string, error: MigrationExecutionError, status: "failed" | "cancelled"): Promise<void> {
    try {
      const metadata = await this.readMetadata(migrationId);
      if (!metadata || metadata.executionStatus === "completed" || metadata.executionStatus === "rolled_back") return;
      await this.writeMetadata({
        ...metadata,
        status: "failed",
        executionStatus: status,
        failedAt: this.isoNow(),
        errorCode: "STORAGE_TRANSACTION_FAILED",
        warnings: [...metadata.warnings, error.code],
        checkpoints: metadata.checkpoints.map((checkpoint) =>
          checkpoint.status === "writing" || checkpoint.status === "written"
            ? { ...checkpoint, status: "failed", errorCode: error.code }
            : checkpoint
        ),
        lastCheckpointAt: this.isoNow()
      });
    } catch {
      // Keep the original execution error. Metadata failure is reported by inspection if needed.
    }
  }

  private async tryMarkRollbackFailed(migrationId: string, error: MigrationExecutionError): Promise<void> {
    try {
      const metadata = await this.readMetadata(migrationId);
      if (!metadata) return;
      await this.writeMetadata({
        ...metadata,
        status: "failed",
        executionStatus: "rollback_failed",
        failedAt: this.isoNow(),
        errorCode: "STORAGE_ROLLBACK_FAILED",
        warnings: [...metadata.warnings, error.code],
        lastCheckpointAt: this.isoNow()
      });
    } catch {
      // Keep rollback failure safe and side-effect light.
    }
  }

  private async writeMetadata(metadata: MigrationExecutionMetadataRecord): Promise<void> {
    await this.targetAdapter.put("migrationMetadata", cloneJsonSafe(metadata, {
      adapter: this.targetAdapter.kind,
      code: "STORAGE_VALIDATION_FAILED",
      recoverable: true
    }) as StorageRecordMap["migrationMetadata"]);
  }

  private async readMetadata(migrationId: string): Promise<MigrationExecutionMetadataRecord | undefined> {
    const record = await this.targetAdapter.get("migrationMetadata", metadataId(migrationId));
    return record as MigrationExecutionMetadataRecord | undefined;
  }

  private async readMetadataOrThrow(migrationId: string): Promise<MigrationExecutionMetadataRecord> {
    const metadata = await this.readMetadata(migrationId);
    if (!metadata) {
      throw new MigrationExecutionError({
        code: "MIGRATION_NOT_FOUND",
        message: "Migration execution metadata was not found.",
        recoverable: true
      });
    }
    return metadata;
  }

  private assertPlanMatchesMetadata(plan: MigrationPlan, metadata: MigrationExecutionMetadataRecord): void {
    if (metadata.id !== metadataId(plan.migrationId) || metadata.backupId !== plan.sourceBackupId || metadata.sourceSnapshotChecksum !== plan.sourceSnapshotChecksum) {
      throw new MigrationExecutionError({
        code: "MIGRATION_PLAN_MISMATCH",
        message: "Resume input does not match stored migration checkpoint metadata.",
        recoverable: false
      });
    }
  }

  private executionStores(metadata: MigrationExecutionMetadataRecord): StorageEntityName[] {
    return MIGRATION_EXECUTION_STORE_ORDER.filter((store) => metadata.checkpoints.some((checkpoint) => checkpoint.store === store));
  }

  private executionStoresFromPlan(plan: MigrationPlan): StorageEntityName[] {
    return MIGRATION_EXECUTION_STORE_ORDER.filter((store) => plan.requiredStores.includes(store) && !SKIPPED_EXECUTION_STORES.has(store));
  }

  private emitProgress(metadata: MigrationExecutionMetadataRecord, status: MigrationExecutionStatus, currentStore?: StorageEntityName): void {
    this.onProgress?.({
      migrationId: metadata.id.replace(EXECUTION_METADATA_ID_PREFIX, ""),
      status,
      currentStore,
      completedStores: metadata.checkpoints.filter((checkpoint) => checkpoint.status === "verified").length,
      totalStores: metadata.checkpoints.length,
      writtenCounts: metadata.writtenCounts,
      verifiedCounts: metadata.verifiedCounts,
      updatedAt: this.isoNow()
    });
  }

  private emitProgressFromValues(
    migrationId: string,
    status: MigrationExecutionStatus,
    writtenCounts: Partial<Record<StorageEntityName, number>>,
    verifiedCounts: Partial<Record<StorageEntityName, number>>
  ): void {
    this.onProgress?.({
      migrationId,
      status,
      completedStores: 0,
      totalStores: 0,
      writtenCounts,
      verifiedCounts,
      updatedAt: this.isoNow()
    });
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new MigrationExecutionError({
        code: "MIGRATION_CANCELLED",
        message: "Migration execution was cancelled.",
        recoverable: true
      });
    }
  }

  private isoNow(): string {
    return this.now().toISOString();
  }

  private toResult(metadata: MigrationExecutionMetadataRecord, status: MigrationExecutionResult["status"], idempotent: boolean): MigrationExecutionResult {
    return {
      migrationId: metadata.id.replace(EXECUTION_METADATA_ID_PREFIX, ""),
      status,
      targetStorage: metadata.targetStorage,
      startedAt: metadata.startedAt,
      completedAt: metadata.completedAt,
      failedAt: metadata.failedAt,
      rolledBackAt: metadata.rolledBackAt,
      backupId: metadata.backupId ?? "",
      backupRecordId: metadata.backupRecordId,
      checkpoints: metadata.checkpoints,
      writtenCounts: metadata.writtenCounts,
      verifiedCounts: metadata.verifiedCounts,
      expectedChecksums: metadata.expectedChecksums,
      targetChecksums: metadata.targetChecksums,
      rollbackAvailable: metadata.rollbackAvailable,
      activeStorageSwitched: false,
      resumed: metadata.resumeCount > 0,
      resumeCount: metadata.resumeCount,
      idempotent,
      warnings: metadata.warnings
    };
  }
}

export function createMigrationExecutor(options: MigrationExecutionOptions): MigrationExecutor {
  return new MigrationExecutor(options);
}

export function metadataId(migrationId: string): string {
  return `${EXECUTION_METADATA_ID_PREFIX}${migrationId}`;
}

export function computeStoreChecksum<K extends StorageEntityName>(store: K, records: StorageRecordMap[K][]): string {
  const sorted = [...records].sort((a, b) =>
    String(getRecordPrimaryKey(store, a)).localeCompare(String(getRecordPrimaryKey(store, b)), "en", { numeric: true })
  );
  return fingerprint(canonicalJsonStringify(sorted, {
    adapter: "memory",
    code: "STORAGE_VALIDATION_FAILED",
    recoverable: true
  }));
}

function recordsForStore<K extends StorageEntityName>(store: K, snapshot: StorageSnapshot, plan: MigrationPlan): StorageRecordMap[K][] {
  const operations = plan.storePlans[store]?.operations ?? [];
  const executableIds = new Set(
    operations
      .filter((operation) => operation.operation === "create" || operation.operation === "update")
      .map((operation) => String(operation.recordId))
  );
  return ((snapshot.records[store] ?? []) as StorageRecordMap[K][]).filter((record) =>
    executableIds.has(String(getRecordPrimaryKey(store, record)))
  );
}

function assertBulkWriteSucceeded(store: StorageEntityName, result: StorageBulkWriteResult, expected: number): void {
  if (result.failed > 0 || result.written !== expected) {
    throw new MigrationExecutionError({
      code: "MIGRATION_WRITE_FAILED",
      message: `Bulk write failed for ${store}.`,
      recoverable: true,
      store
    });
  }
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
