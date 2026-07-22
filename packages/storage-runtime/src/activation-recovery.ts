import {
  MIGRATION_WRITER_LOCK_NAME,
  ActivationJournalRepository,
  metadataId,
  type MigrationExecutionMetadataRecord,
  type MigrationLockHandle,
  type MigrationLockProvider,
  type StorageActivationJournalV1,
  type StorageAdapter
} from "@revival/storage-service";
import { ActivationError } from "./activation-errors";
import {
  StorageBootstrapMarkerStore,
  createIndexedDbActiveMarker,
  createLegacyActiveMarker,
  type BootstrapMarkerStorageLike,
  type StorageBootstrapMarkerReadResult,
  type StorageBootstrapMarkerV1
} from "./bootstrap-marker";
import type { StorageRuntimeBroadcast } from "./runtime-broadcast";
import type { StorageWriteGate } from "./write-gate";

export type ActivationRecoveryAction =
  | "return_to_data_management"
  | "cancel_prepare"
  | "retry_indexeddb_boot"
  | "cancel_uncommitted_activation"
  | "finalize_committed_marker"
  | "export_legacy_backup"
  | "export_indexeddb_snapshot"
  | "export_safe_report";

export interface SafeActivationRecoveryReport {
  markerState: string;
  journalStatus?: string;
  migrationStatus?: string;
  activeStorageSwitched?: boolean;
  indexedDbReadable: boolean;
  backupAvailable: boolean;
  safeErrorCode?: string;
  allowedActions: ActivationRecoveryAction[];
  checkedAt: string;
}

export interface InspectActivationRecoveryInput {
  markerRead: StorageBootstrapMarkerReadResult;
  journal?: StorageActivationJournalV1;
  metadata?: MigrationExecutionMetadataRecord;
  indexedDbReadable: boolean;
  backupAvailable: boolean;
  safeErrorCode?: string;
  checkedAt?: string;
}

export function createSafeActivationRecoveryReport(input: InspectActivationRecoveryInput): SafeActivationRecoveryReport {
  const markerState = input.markerRead.status === "valid" ? input.markerRead.marker.state : input.markerRead.status;
  const committed = Boolean(input.metadata?.activeStorageSwitched || input.journal?.status === "committed");
  const prepared = input.markerRead.status === "valid" && input.markerRead.marker.state === "activation_prepared";
  const preCommit = !committed && input.markerRead.status === "valid" &&
    (input.markerRead.marker.state === "activating" || input.markerRead.marker.state === "recovery_required") &&
    Boolean(input.journal && ["switching", "boot_verifying", "activation_failed"].includes(input.journal.status));
  const actions = new Set<ActivationRecoveryAction>(["export_safe_report"]);
  if (input.backupAvailable) actions.add("export_legacy_backup");
  if (input.indexedDbReadable) actions.add("export_indexeddb_snapshot");
  if (prepared) {
    actions.add("return_to_data_management");
    actions.add("cancel_prepare");
  }
  if (preCommit) {
    actions.add("retry_indexeddb_boot");
    actions.add("cancel_uncommitted_activation");
  }
  if (committed) {
    actions.add("retry_indexeddb_boot");
    if (input.markerRead.status !== "valid" || input.markerRead.marker.state !== "indexeddb_active") {
      actions.add("finalize_committed_marker");
    }
  }
  if (input.markerRead.status === "valid" && input.markerRead.marker.state === "indexeddb_active") {
    actions.add("retry_indexeddb_boot");
  }
  return {
    markerState,
    journalStatus: input.journal?.status,
    migrationStatus: input.metadata?.executionStatus,
    activeStorageSwitched: input.metadata?.activeStorageSwitched,
    indexedDbReadable: input.indexedDbReadable,
    backupAvailable: input.backupAvailable,
    safeErrorCode: input.safeErrorCode ?? (input.markerRead.status === "valid" ? input.markerRead.marker.errorCode : input.markerRead.status === "missing" ? undefined : input.markerRead.errorCode),
    allowedActions: [...actions],
    checkedAt: input.checkedAt ?? new Date().toISOString()
  };
}

export interface ActivationRecoveryCoordinatorOptions {
  lockProvider: MigrationLockProvider;
  markerStorage: BootstrapMarkerStorageLike;
  targetAdapter: StorageAdapter;
  journalRepository: ActivationJournalRepository;
  writeGate: StorageWriteGate;
  broadcast: StorageRuntimeBroadcast;
  verifyLegacySource: (migrationId: string) => Promise<boolean>;
  now?: () => Date;
}

export class ActivationRecoveryCoordinator {
  private readonly markerStore: StorageBootstrapMarkerStore;
  private readonly now: () => Date;
  private lockHeld = false;

  constructor(private readonly options: ActivationRecoveryCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.markerStore = new StorageBootstrapMarkerStore(options.markerStorage, { assertWriteLockHeld: () => this.lockHeld });
  }

  async cancelUncommittedActivation(input: { activationId: string; migrationId: string; userConfirmed: boolean }): Promise<StorageBootstrapMarkerV1> {
    if (!input.userConfirmed) throw recoveryError("ACTIVATION_CONFIRMATION_REQUIRED", true);
    this.assertLockProvider();
    let lock: MigrationLockHandle | undefined;
    try {
      lock = await this.options.lockProvider.acquire({ name: MIGRATION_WRITER_LOCK_NAME, migrationId: `activation-recovery-cancel:${input.activationId}` });
      this.lockHeld = true;
      const markerRead = await this.markerStore.read();
      const journal = await this.options.journalRepository.read(input.activationId);
      const metadata = await this.readMetadata(input.migrationId);
      if (metadata?.activeStorageSwitched || journal?.status === "committed") {
        throw recoveryError("ACTIVATION_CANCEL_AFTER_COMMIT_FORBIDDEN", false);
      }
      if (markerRead.status !== "valid" || markerRead.marker.activationId !== input.activationId ||
          markerRead.marker.migrationId !== input.migrationId || markerRead.marker.state !== "activating" ||
          !journal || !["switching", "boot_verifying", "activation_failed"].includes(journal.status) || !metadata ||
          !await this.options.verifyLegacySource(input.migrationId)) {
        throw recoveryError("ACTIVATION_CANCEL_NOT_ALLOWED", false);
      }
      await this.options.journalRepository.transition(input.activationId, [journal.status], "cancelled", { updatedAt: this.now().toISOString() });
      const legacy = createLegacyActiveMarker(markerRead.marker, this.now().toISOString());
      await this.markerStore.writeExpectedRevision(markerRead.marker.revision, legacy);
      this.options.broadcast.publish({ type: "activation_prepare_cancelled", activationId: input.activationId, revision: legacy.revision });
      this.options.writeGate.reopen();
      return legacy;
    } finally {
      this.lockHeld = false;
      await lock?.release();
    }
  }

  async finalizeCommittedMarker(input: { activationId: string; migrationId: string }): Promise<StorageBootstrapMarkerV1> {
    this.assertLockProvider();
    let lock: MigrationLockHandle | undefined;
    try {
      lock = await this.options.lockProvider.acquire({ name: MIGRATION_WRITER_LOCK_NAME, migrationId: `activation-marker-repair:${input.activationId}` });
      this.lockHeld = true;
      const markerRead = await this.markerStore.read();
      const journal = await this.options.journalRepository.read(input.activationId);
      const metadata = await this.readMetadata(input.migrationId);
      if (!journal || journal.status !== "committed" || !metadata?.activeStorageSwitched ||
          journal.migrationId !== input.migrationId || metadata.activationId !== input.activationId) {
        throw recoveryError("RECOVERY_MARKER_REPAIR_FAILED", false);
      }
      let marker: StorageBootstrapMarkerV1;
      if (markerRead.status === "valid" && markerRead.marker.state === "indexeddb_active") return markerRead.marker;
      if (markerRead.status === "valid" && (markerRead.marker.state === "activating" || markerRead.marker.state === "recovery_required")) {
        marker = createIndexedDbActiveMarker(markerRead.marker, this.now().toISOString());
        await this.markerStore.writeExpectedRevision(markerRead.marker.revision, marker);
      } else {
        const activatedAt = this.now().toISOString();
        marker = {
          version: 1,
          revision: journal.markerRevisionCommitted ?? ((journal.markerRevisionActivating ?? journal.bootstrapRevisionPrepared ?? 0) + 1),
          state: "indexeddb_active",
          activeBackend: "indexedDB",
          migrationId: input.migrationId,
          activationId: input.activationId,
          journalId: journal.id,
          databaseName: journal.databaseName,
          schemaVersion: journal.schemaVersion,
          sourceRawChecksum: journal.sourceRawChecksum,
          sourceNormalizedChecksum: journal.sourceNormalizedChecksum,
          targetRuntimeChecksum: journal.targetRuntimeChecksum,
          preparedAt: journal.preparedAt ?? journal.createdAt,
          activatingAt: journal.switchingAt ?? journal.updatedAt,
          activatedAt,
          updatedAt: activatedAt
        };
        await this.markerStore.repairCommittedMarker(marker);
      }
      this.options.broadcast.publish({ type: "storage_backend_activated", activationId: input.activationId, revision: marker.revision, backend: "indexedDB" });
      this.options.writeGate.markIndexedDbActive();
      return marker;
    } catch (cause) {
      if (cause instanceof ActivationError) throw cause;
      throw recoveryError("RECOVERY_MARKER_REPAIR_FAILED", true, cause);
    } finally {
      this.lockHeld = false;
      await lock?.release();
    }
  }

  private async readMetadata(migrationId: string): Promise<MigrationExecutionMetadataRecord | undefined> {
    const value = await this.options.targetAdapter.get("migrationMetadata", metadataId(migrationId));
    return value && "executionStatus" in value ? value as MigrationExecutionMetadataRecord : undefined;
  }
  private assertLockProvider(): void {
    if (this.options.lockProvider.kind !== "web-locks" || this.options.lockProvider.isAvailable?.() === false) {
      throw recoveryError("ACTIVATION_CAPABILITY_UNAVAILABLE", true);
    }
  }
}

function recoveryError(code: ConstructorParameters<typeof ActivationError>[0]["code"], recoverable: boolean, cause?: unknown): ActivationError {
  return new ActivationError({ code, recoverable, cause });
}