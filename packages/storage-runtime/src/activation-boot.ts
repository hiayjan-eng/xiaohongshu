import {
  MIGRATION_WRITER_LOCK_NAME,
  ActivationCommitRepository,
  ActivationJournalRepository,
  RUNTIME_ACTIVATION_METADATA_KEY,
  metadataId,
  parseRuntimeActivationMetadata,
  type MigrationExecutionMetadataRecord,
  type MigrationLockHandle,
  type MigrationLockProvider,
  type SafeBootVerificationSummary,
  type StorageAdapter
} from "@revival/storage-service";
import { ActivationError } from "./activation-errors";
import {
  StorageBootstrapMarkerStore,
  createIndexedDbActiveMarker,
  type BootstrapMarkerStorageLike,
  type StorageBootstrapMarkerV1
} from "./bootstrap-marker";
import type { IndexedDbRuntime } from "./indexeddb-runtime";
import { computeRuntimeBundleChecksum } from "./source-drift";
import { verifyTargetStoreChecksums } from "./activation-preflight";
import type { StorageRuntimeBroadcast } from "./runtime-broadcast";
import type { StorageRuntimeLoadResult } from "./contracts";
import type { StorageWriteGate } from "./write-gate";

export type ActivationBootStage =
  | "boot_opening_indexeddb"
  | "boot_health_check"
  | "boot_hydrating"
  | "boot_verifying"
  | "committing_activation"
  | "finalizing_marker"
  | "indexeddb_active";

export type ActivationBootFaultPoint =
  | "after_reload_before_open"
  | "after_open_before_health"
  | "after_health_before_hydrate"
  | "after_hydrate_before_commit"
  | "after_commit_before_marker_finalize"
  | "after_marker_finalize_before_render";

export interface ActivationBootFaultInjector {
  inject?(point: ActivationBootFaultPoint): Promise<void> | void;
}

export interface ActivationBootCoordinatorOptions {
  lockProvider: MigrationLockProvider;
  markerStorage: BootstrapMarkerStorageLike;
  targetAdapter: StorageAdapter;
  targetRuntime: IndexedDbRuntime;
  journalRepository: ActivationJournalRepository;
  commitRepository?: ActivationCommitRepository;
  writeGate: StorageWriteGate;
  broadcast: StorageRuntimeBroadcast;
  now?: () => Date;
  onStage?: (stage: ActivationBootStage) => void;
  faultInjector?: ActivationBootFaultInjector;
}

export interface ActivationBootReadyResult {
  status: "indexeddb_active";
  runtime: IndexedDbRuntime;
  loadResult: StorageRuntimeLoadResult;
  marker: StorageBootstrapMarkerV1;
  activationId: string;
  migrationId: string;
  committedDuringBoot: boolean;
}

export class ActivationBootCoordinator {
  private readonly markerStore: StorageBootstrapMarkerStore;
  private readonly commitRepository: ActivationCommitRepository;
  private readonly now: () => Date;
  private lockHeld = false;
  private inFlight?: Promise<ActivationBootReadyResult>;

  constructor(private readonly options: ActivationBootCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.markerStore = new StorageBootstrapMarkerStore(options.markerStorage, { assertWriteLockHeld: () => this.lockHeld });
    this.commitRepository = options.commitRepository ?? new ActivationCommitRepository(options.targetAdapter);
  }

  boot(): Promise<ActivationBootReadyResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performBoot().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async performBoot(): Promise<ActivationBootReadyResult> {
    this.assertCapabilities();
    let lock: MigrationLockHandle | undefined;
    let runtimeReady = false;
    let committedDuringBoot = false;
    let activationId: string | undefined;
    let migrationId: string | undefined;
    try {
      lock = await this.options.lockProvider.acquire({
        name: MIGRATION_WRITER_LOCK_NAME,
        migrationId: `activation-boot:${this.now().getTime()}`
      });
      this.lockHeld = true;
      const markerRead = await this.markerStore.read();
      if (markerRead.status !== "valid" || (markerRead.marker.state !== "activating" && markerRead.marker.state !== "indexeddb_active")) {
        throw activationError("ACTIVATION_RUNTIME_SELECTION_FAILED", false);
      }
      let marker = markerRead.marker;
      activationId = marker.activationId;
      migrationId = marker.migrationId;
      if (!activationId || !migrationId || marker.activeBackend !== "indexedDB") {
        throw activationError("ACTIVATION_BACKEND_CONFLICT", false);
      }
      this.options.writeGate.markSwitching();
      await this.inject("after_reload_before_open");
      this.emit("boot_opening_indexeddb");
      await this.options.targetRuntime.open().catch((cause) => { throw activationError("ACTIVATION_BOOT_OPEN_FAILED", true, cause); });
      await this.inject("after_open_before_health");

      let journal = await this.options.journalRepository.read(activationId);
      let metadata = await this.readMetadata(migrationId);
      if (!journal || !metadata || journal.migrationId !== migrationId) {
        throw activationError("ACTIVATION_BACKEND_CONFLICT", false);
      }
      if (marker.state === "indexeddb_active" && (!metadata.activeStorageSwitched || journal.status !== "committed")) {
        throw activationError("ACTIVATION_BACKEND_CONFLICT", false);
      }
      if (marker.state === "activating" && metadata.activeStorageSwitched !== (journal.status === "committed")) {
        throw activationError("ACTIVATION_BACKEND_CONFLICT", false);
      }

      this.emit("boot_health_check");
      const health = await this.options.targetRuntime.healthCheck().catch((cause) => {
        throw activationError("ACTIVATION_BOOT_HEALTH_FAILED", true, cause);
      });
      if (!health.ok) throw activationError("ACTIVATION_BOOT_HEALTH_FAILED", true);
      await this.inject("after_health_before_hydrate");

      this.emit("boot_hydrating");
      const loadResult = await this.options.targetRuntime.loadAppState().catch((cause) => {
        throw activationError("ACTIVATION_BOOT_HYDRATE_FAILED", true, cause);
      });
      if (loadResult.warnings.some((warning) => warning.blocking)) {
        throw activationError("ACTIVATION_BOOT_HYDRATE_FAILED", true);
      }

      this.emit("boot_verifying");
      // The prepared checksum is a cutover invariant. After activation commits,
      // normal IndexedDB writes legitimately change the runtime bundle.
      if (!metadata.activeStorageSwitched) {
        const checksum = await computeRuntimeBundleChecksum({ state: loadResult.state, settings: loadResult.settings });
        if (checksum !== marker.targetRuntimeChecksum) {
          throw activationError("ACTIVATION_BOOT_VERIFICATION_FAILED", false);
        }
      }
      if (!metadata.activeStorageSwitched && !await verifyTargetStoreChecksums(this.options.targetAdapter, metadata)) {
        throw activationError("ACTIVATION_BOOT_VERIFICATION_FAILED", false);
      }
      const summary: SafeBootVerificationSummary = {
        verified: true,
        checkedAt: this.now().toISOString(),
        runtimeKind: "indexedDB",
        schemaVersion: marker.schemaVersion ?? 1,
        targetRuntimeChecksumVerified: true,
        referencesVerified: true,
        blockingIssueCodes: [],
        warningCodes: []
      };

      if (!metadata.activeStorageSwitched) {
        journal = await this.options.journalRepository.transition(
          activationId,
          journal.status === "boot_verifying" ? ["boot_verifying"] : ["switching", "activation_failed"],
          "boot_verifying",
          { updatedAt: this.now().toISOString(), bootVerificationSummary: summary }
        );
        await this.inject("after_hydrate_before_commit");
        this.emit("committing_activation");
        const commit = await this.commitRepository.commit({
          activationId,
          migrationId,
          committedAt: this.now().toISOString(),
          markerRevisionCommitted: marker.revision + 1,
          bootVerificationSummary: summary
        }).catch((cause) => { throw activationError("ACTIVATION_COMMIT_FAILED", true, cause); });
        metadata = commit.metadata;
        journal = commit.journal;
        committedDuringBoot = !commit.idempotent;
      } else {
        const activationSetting = parseRuntimeActivationMetadata(await this.options.targetAdapter.get("settings", RUNTIME_ACTIVATION_METADATA_KEY));
        if (!activationSetting || activationSetting.activationId !== activationId || activationSetting.migrationId !== migrationId) {
          throw activationError("ACTIVATION_BOOT_VERIFICATION_FAILED", false);
        }
      }

      if (marker.state !== "indexeddb_active") {
        await this.inject("after_commit_before_marker_finalize");
        this.emit("finalizing_marker");
        const finalMarker = createIndexedDbActiveMarker(marker, this.now().toISOString());
        await this.markerStore.writeExpectedRevision(marker.revision, finalMarker).catch((cause) => {
          throw activationError("ACTIVATION_MARKER_FINALIZE_FAILED", true, cause);
        });
        marker = finalMarker;
      }
      this.options.broadcast.publish({
        type: "storage_backend_activated",
        activationId,
        revision: marker.revision,
        backend: "indexedDB"
      });
      this.options.writeGate.markIndexedDbActive();
      this.emit("indexeddb_active");
      await this.inject("after_marker_finalize_before_render");
      runtimeReady = true;
      return { status: "indexeddb_active", runtime: this.options.targetRuntime, loadResult, marker, activationId, migrationId, committedDuringBoot };
    } catch (cause) {
      const code = safeCode(cause);
      if (activationId) {
        const journal = await this.options.journalRepository.read(activationId).catch(() => undefined);
        if (journal && journal.status !== "committed" && journal.status !== "cancelled") {
          await this.options.journalRepository.transition(
            activationId,
            [journal.status],
            "activation_failed",
            { updatedAt: this.now().toISOString(), errorCode: code }
          ).catch(() => undefined);
        }
      }
      this.options.broadcast.publish({ type: "storage_recovery_required", activationId, errorCode: code });
      if (cause instanceof ActivationError) throw cause;
      throw activationError("ACTIVATION_BOOT_VERIFICATION_FAILED", true, cause);
    } finally {
      this.lockHeld = false;
      await lock?.release();
      if (!runtimeReady) await this.options.targetRuntime.close().catch(() => undefined);
    }
  }

  private async readMetadata(migrationId: string): Promise<MigrationExecutionMetadataRecord | undefined> {
    const value = await this.options.targetAdapter.get("migrationMetadata", metadataId(migrationId));
    if (!value || !("executionStatus" in value)) return undefined;
    const candidate = value as Partial<MigrationExecutionMetadataRecord>;
    if (typeof candidate.activeStorageSwitched !== "boolean") return undefined;
    return candidate as MigrationExecutionMetadataRecord;
  }
  private assertCapabilities(): void {
    if (this.options.lockProvider.kind !== "web-locks" || this.options.lockProvider.isAvailable?.() === false) {
      throw activationError("ACTIVATION_CAPABILITY_UNAVAILABLE", true);
    }
  }
  private emit(stage: ActivationBootStage): void { this.options.onStage?.(stage); }
  private async inject(point: ActivationBootFaultPoint): Promise<void> { await this.options.faultInjector?.inject?.(point); }
}

function activationError(code: ConstructorParameters<typeof ActivationError>[0]["code"], recoverable: boolean, cause?: unknown): ActivationError {
  return new ActivationError({ code, recoverable, cause });
}
function safeCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "ACTIVATION_BOOT_VERIFICATION_FAILED";
}
