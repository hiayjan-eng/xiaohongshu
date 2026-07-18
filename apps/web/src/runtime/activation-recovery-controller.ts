import {
  ActivationJournalRepository,
  MigrationExecutor,
  canonicalJsonStringify,
  computeSha256,
  metadataId,
  type MigrationExecutionMetadataRecord,
  type MigrationLockProvider,
  type StorageActivationJournalV1,
  type StorageAdapter
} from "@revival/storage-service";
import {
  ActivationBootCoordinator,
  ActivationRecoveryCoordinator,
  IndexedDbRuntime,
  StorageBootstrapMarkerStore,
  StorageWriteGate,
  checkSourceDrift,
  createBrowserStorageRuntimeBroadcast,
  createSafeActivationRecoveryReport,
  type ActivationBootReadyResult,
  type ActivationBootStage,
  type SafeActivationRecoveryReport,
  type StorageBootstrapMarkerReadResult,
  type StorageRuntimeBroadcast
} from "@revival/storage-runtime";
import { createReadonlyBrowserStorage } from "../features/storage-migration/migration-flow-controller";
import {
  MIGRATION_TARGET_SCHEMA_VERSION,
  createBrowserMigrationExecutionRuntime,
  type MigrationExecutionRuntime
} from "../features/storage-migration/migration-execution-runtime";
import type { PreparedMigrationDownload } from "../features/storage-migration/migration-recovery-controller";

export interface ActivationRecoveryControllerOptions {
  executionRuntime?: MigrationExecutionRuntime;
  markerStorage?: Storage;
  now?: () => Date;
}

export class BrowserActivationRecoveryController {
  readonly writeGate = new StorageWriteGate("activation_switching");
  private readonly executionRuntime: MigrationExecutionRuntime;
  private readonly markerStorage: Storage;
  private readonly now: () => Date;
  private readonly adapter: StorageAdapter;
  private readonly lockProvider: ReturnType<MigrationExecutionRuntime["createLockProvider"]>;
  private readonly runtime: IndexedDbRuntime;
  private readonly journals: ActivationJournalRepository;
  private readonly broadcast: StorageRuntimeBroadcast;

  constructor(options: ActivationRecoveryControllerOptions = {}) {
    this.executionRuntime = options.executionRuntime ?? createBrowserMigrationExecutionRuntime();
    if (!options.markerStorage && typeof globalThis.localStorage === "undefined") throw new Error("ACTIVATION_MARKER_STORAGE_UNAVAILABLE");
    this.markerStorage = options.markerStorage ?? globalThis.localStorage;
    this.now = options.now ?? (() => new Date());
    this.adapter = this.executionRuntime.createTargetAdapter();
    this.lockProvider = this.executionRuntime.isWebLocksAvailable()
      ? this.executionRuntime.createLockProvider()
      : unavailableLockProvider();
    this.runtime = new IndexedDbRuntime({ adapter: this.adapter, expectedSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION, now: this.now });
    this.journals = new ActivationJournalRepository(this.adapter);
    this.broadcast = createBrowserStorageRuntimeBroadcast();
  }

  async boot(onStage?: (stage: ActivationBootStage) => void): Promise<ActivationBootReadyResult> {
    return new ActivationBootCoordinator({
      lockProvider: this.lockProvider,
      markerStorage: this.markerStorage,
      targetAdapter: this.adapter,
      targetRuntime: this.runtime,
      journalRepository: this.journals,
      writeGate: this.writeGate,
      broadcast: this.broadcast,
      now: this.now,
      onStage
    }).boot();
  }

  async inspect(safeErrorCode?: string): Promise<SafeActivationRecoveryReport> {
    const markerRead = await new StorageBootstrapMarkerStore(this.markerStorage).read();
    let indexedDbReadable = false;
    let journal: StorageActivationJournalV1 | undefined;
    let metadata: MigrationExecutionMetadataRecord | undefined;
    let backupAvailable = false;
    try {
      await this.adapter.open();
      indexedDbReadable = (await this.adapter.healthCheck()).available;
      const journals = await this.journals.list();
      const activationId = markerRead.status === "valid" ? markerRead.marker.activationId : undefined;
      journal = activationId ? journals.find((entry) => entry.activationId === activationId) :
        [...journals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (journal) {
        const record = await this.adapter.get("migrationMetadata", metadataId(journal.migrationId));
        if (record && "executionStatus" in record) metadata = record as MigrationExecutionMetadataRecord;
      }
      if (metadata?.backupRecordId) backupAvailable = Boolean(await this.adapter.get("backups", metadata.backupRecordId));
    } catch {
      indexedDbReadable = false;
    }
    return createSafeActivationRecoveryReport({ markerRead, journal, metadata, indexedDbReadable, backupAvailable, safeErrorCode, checkedAt: this.now().toISOString() });
  }

  async cancelUncommittedActivation(report: SafeActivationRecoveryReport, userConfirmed: boolean): Promise<void> {
    const ids = await this.requireIds(report);
    const recovery = new ActivationRecoveryCoordinator({
      lockProvider: this.lockProvider,
      markerStorage: this.markerStorage,
      targetAdapter: this.adapter,
      journalRepository: this.journals,
      writeGate: this.writeGate,
      broadcast: this.broadcast,
      verifyLegacySource: (migrationId) => this.verifyLegacySource(migrationId),
      now: this.now
    });
    await recovery.cancelUncommittedActivation({ ...ids, userConfirmed });
  }

  async finalizeCommittedMarker(report: SafeActivationRecoveryReport): Promise<void> {
    const ids = await this.requireIds(report);
    const recovery = new ActivationRecoveryCoordinator({
      lockProvider: this.lockProvider,
      markerStorage: this.markerStorage,
      targetAdapter: this.adapter,
      journalRepository: this.journals,
      writeGate: this.writeGate,
      broadcast: this.broadcast,
      verifyLegacySource: (migrationId) => this.verifyLegacySource(migrationId),
      now: this.now
    });
    await recovery.finalizeCommittedMarker(ids);
  }

  async prepareLegacyBackupDownload(report: SafeActivationRecoveryReport): Promise<PreparedMigrationDownload> {
    const { migrationId } = await this.requireIds(report);
    const executor = this.createExecutor();
    const backup = await executor.readPersistedBackup(migrationId);
    return {
      blob: new Blob([backup.serializedEnvelope], { type: "application/json;charset=utf-8" }),
      filename: `collection-revival-backup-${dateStamp(backup.envelope.createdAt)}.json`
    };
  }

  async prepareIndexedDbSnapshotDownload(): Promise<PreparedMigrationDownload> {
    await this.adapter.open();
    const snapshot = await this.adapter.exportSnapshot();
    const canonical = canonicalJsonStringify(snapshot, { adapter: "indexedDB", code: "STORAGE_EXPORT_FAILED", recoverable: true });
    const checksum = await computeSha256(canonical);
    const serialized = JSON.stringify({ formatVersion: 1, checksum, snapshot }, null, 2);
    return {
      blob: new Blob([serialized], { type: "application/json;charset=utf-8" }),
      filename: `collection-revival-indexeddb-snapshot-${dateStamp(this.now().toISOString())}.json`
    };
  }

  prepareSafeReportDownload(report: SafeActivationRecoveryReport): PreparedMigrationDownload {
    return {
      blob: new Blob([JSON.stringify({ formatVersion: 1, report }, null, 2)], { type: "application/json;charset=utf-8" }),
      filename: `collection-revival-storage-recovery-${dateStamp(report.checkedAt)}.json`
    };
  }

  async close(): Promise<void> {
    this.broadcast.close();
    await this.runtime.close().catch(() => undefined);
    await this.adapter.close().catch(() => undefined);
  }

  private createExecutor(): MigrationExecutor {
    return new MigrationExecutor({
      targetAdapter: this.adapter,
      lockProvider: this.lockProvider,
      expectedTargetSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION
    });
  }

  private async verifyLegacySource(migrationId: string): Promise<boolean> {
    const metadataRecord = await this.adapter.get("migrationMetadata", metadataId(migrationId));
    if (!metadataRecord || !("executionStatus" in metadataRecord)) return false;
    const metadata = metadataRecord as MigrationExecutionMetadataRecord;
    const backup = await this.createExecutor().readPersistedBackup(migrationId);
    const drift = await checkSourceDrift({
      readonlyStorage: createReadonlyBrowserStorage(),
      migrationMetadata: metadata,
      backup,
      now: this.now
    });
    return !drift.blocking && !drift.drifted;
  }

  private async requireIds(report: SafeActivationRecoveryReport): Promise<{ activationId: string; migrationId: string }> {
    await this.adapter.open();
    const marker = await new StorageBootstrapMarkerStore(this.markerStorage).read();
    const journals = await this.journals.list();
    const journal = marker.status === "valid" && marker.marker.activationId
      ? journals.find((entry) => entry.activationId === marker.marker.activationId)
      : journals.find((entry) => entry.status === report.journalStatus);
    if (!journal) throw new Error("ACTIVATION_JOURNAL_MISSING");
    return { activationId: journal.activationId, migrationId: journal.migrationId };
  }
}

function dateStamp(value: string): string {
  const date = new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function unavailableLockProvider(): MigrationLockProvider {
  return {
    kind: "web-locks",
    isAvailable: () => false,
    acquire: async () => { throw new Error("ACTIVATION_CAPABILITY_UNAVAILABLE"); }
  };
}