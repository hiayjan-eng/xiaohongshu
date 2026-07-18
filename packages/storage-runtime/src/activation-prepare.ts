import {
  ACTIVATION_JOURNAL_ID_PREFIX,
  MIGRATION_WRITER_LOCK_NAME,
  ActivationJournalRepository,
  type MigrationLockHandle,
  type MigrationLockProvider
} from "@revival/storage-service";
import { ActivationError } from "./activation-errors";
import {
  StorageBootstrapMarkerStore,
  createLegacyActiveMarker,
  type BootstrapMarkerStorageLike,
  type StorageBootstrapMarkerV1
} from "./bootstrap-marker";
import type { ActivationPreflightResult } from "./activation-preflight";
import type { StorageRuntimeBroadcast } from "./runtime-broadcast";
import type { StorageWriteGate } from "./write-gate";

export type ActivationPrepareStage =
  | "acquiring_activation_lock"
  | "freezing_writes"
  | "refreshing_source"
  | "checking_source_drift"
  | "checking_target"
  | "checking_equivalence"
  | "creating_activation_journal"
  | "writing_bootstrap_marker"
  | "finalizing_prepare"
  | "activation_prepared"
  | "cancelling_prepare"
  | "prepare_cancelled"
  | "recovery_required";

export interface ActivationPrepareConfirmations {
  prepareOnly: boolean;
  freezeOtherPages: boolean;
  legacyRemainsActive: boolean;
  cancellationAvailable: boolean;
}

export interface ActivationPrepareResult {
  status: "activation_prepared" | "prepare_cancelled";
  activationId: string;
  migrationId: string;
  marker: StorageBootstrapMarkerV1;
  idempotent: boolean;
  activeBackend: "localStorage";
  activeStorageSwitched: false;
}

export interface ActivationPreparerOptions {
  lockProvider: MigrationLockProvider;
  markerStorage: BootstrapMarkerStorageLike;
  journalRepository: ActivationJournalRepository;
  writeGate: StorageWriteGate;
  broadcast: StorageRuntimeBroadcast;
  flushPendingWrites: () => Promise<void>;
  runPreflight: () => Promise<ActivationPreflightResult>;
  assertMigrationInactive: (migrationId: string) => Promise<boolean>;
  now?: () => Date;
  onStage?: (stage: ActivationPrepareStage) => void;
}

export class ActivationPreparer {
  private readonly now: () => Date;
  private lockHeld = false;
  private readonly markerStore: StorageBootstrapMarkerStore;

  constructor(private readonly options: ActivationPreparerOptions) {
    this.now = options.now ?? (() => new Date());
    this.markerStore = new StorageBootstrapMarkerStore(options.markerStorage, {
      assertWriteLockHeld: () => this.lockHeld
    });
  }

  async prepare(confirmations: ActivationPrepareConfirmations): Promise<ActivationPrepareResult> {
    if (!Object.values(confirmations).every(Boolean)) throw activationError("ACTIVATION_PREFLIGHT_FAILED", true);
    this.assertLockProvider();
    this.emit("acquiring_activation_lock");
    let lock: MigrationLockHandle | undefined;
    let markerWritten = false;
    let activationId = "activation-unavailable";
    let migrationId = "migration-unavailable";
    try {
      lock = await this.options.lockProvider.acquire({
        name: MIGRATION_WRITER_LOCK_NAME,
        migrationId: `activation-prepare:${this.now().getTime()}`
      });
      this.lockHeld = true;
      const initialMarker = await this.markerStore.read();
      const alreadyPrepared = initialMarker.status === "valid" && initialMarker.marker.state === "activation_prepared";
      if (alreadyPrepared) {
        this.options.writeGate.markPrepared();
      } else {
        this.emit("freezing_writes");
        this.options.writeGate.enterPreflight();
        const initialRevision = initialMarker.status === "valid" ? initialMarker.marker.revision : 0;
        this.options.broadcast.publish({ type: "activation_preflight_started", activationId: "pending", revision: initialRevision });
        await this.options.flushPendingWrites().catch((cause) => { throw activationError("ACTIVATION_WRITE_GATE_FAILED", true, cause); });
      }

      this.emit("refreshing_source");
      this.emit("checking_source_drift");
      const preflight = await this.options.runPreflight();
      migrationId = preflight.report.migrationId;
      activationId = preflight.report.activationCandidateId;
      if (!preflight.report.eligible || !preflight.evidence) throw activationError("ACTIVATION_PREFLIGHT_FAILED", true);

      if (preflight.evidence.marker?.state === "activation_prepared") {
        this.options.writeGate.markPrepared();
        this.emit("activation_prepared");
        return {
          status: "activation_prepared",
          activationId: preflight.evidence.marker.activationId!,
          migrationId: preflight.evidence.marker.migrationId!,
          marker: preflight.evidence.marker,
          idempotent: true,
          activeBackend: "localStorage",
          activeStorageSwitched: false
        };
      }

      this.emit("checking_target");
      this.emit("checking_equivalence");
      this.emit("creating_activation_journal");
      const timestamp = this.now().toISOString();
      const created = await this.options.journalRepository.createOrReuse({
        activationId,
        migrationId,
        sourceRawChecksum: preflight.evidence.sourceRawChecksum,
        sourceNormalizedChecksum: preflight.evidence.sourceNormalizedChecksum,
        targetRuntimeChecksum: preflight.evidence.targetRuntimeChecksum,
        bootstrapRevisionBefore: preflight.evidence.bootstrapRevisionBefore,
        preflightSummary: {
          eligible: true,
          checkedAt: preflight.report.checkedAt,
          blockingIssueCodes: [],
          warningCodes: preflight.report.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)
        },
        createdAt: timestamp
      });
      if (created.journal.status === "prepared") {
        const markerRead = await this.markerStore.read();
        if (markerRead.status !== "valid" || markerRead.marker.activationId !== activationId) {
          throw activationError("ACTIVATION_JOURNAL_CONFLICT", false);
        }
        this.options.writeGate.markPrepared();
        return { status: "activation_prepared", activationId, migrationId, marker: markerRead.marker, idempotent: true, activeBackend: "localStorage", activeStorageSwitched: false };
      }
      if (created.journal.status !== "preparing") throw activationError("ACTIVATION_JOURNAL_CONFLICT", false);

      this.emit("writing_bootstrap_marker");
      const markerRevision = (preflight.evidence.bootstrapRevisionBefore ?? 0) + 1;
      const marker: StorageBootstrapMarkerV1 = {
        version: 1,
        revision: markerRevision,
        state: "activation_prepared",
        activeBackend: "localStorage",
        migrationId,
        activationId,
        journalId: `${ACTIVATION_JOURNAL_ID_PREFIX}${activationId}`,
        databaseName: "collection-revival-local",
        schemaVersion: 1,
        sourceRawChecksum: preflight.evidence.sourceRawChecksum,
        sourceNormalizedChecksum: preflight.evidence.sourceNormalizedChecksum,
        targetRuntimeChecksum: preflight.evidence.targetRuntimeChecksum,
        preparedAt: timestamp,
        updatedAt: timestamp
      };
      await this.markerStore.writeExpectedRevision(preflight.evidence.bootstrapRevisionBefore, marker);
      markerWritten = true;

      this.emit("finalizing_prepare");
      await this.options.journalRepository.transition(activationId, ["preparing"], "prepared", {
        updatedAt: this.now().toISOString(),
        bootstrapRevisionPrepared: markerRevision
      });
      this.options.broadcast.publish({ type: "activation_prepared", activationId, revision: markerRevision });
      this.options.writeGate.markPrepared();
      this.emit("activation_prepared");
      return { status: "activation_prepared", activationId, migrationId, marker, idempotent: created.reused, activeBackend: "localStorage", activeStorageSwitched: false };
    } catch (cause) {
      if (activationId !== "activation-unavailable" && !markerWritten) {
        await this.options.journalRepository.transition(activationId, ["preparing"], "prepare_failed", {
          updatedAt: this.now().toISOString(),
          errorCode: safeCode(cause)
        }).catch(() => undefined);
      }
      if (markerWritten) {
        await this.markRecoveryRequired(activationId, migrationId, safeCode(cause)).catch(() => undefined);
        this.options.writeGate.markPrepared();
        this.emit("recovery_required");
      } else {
        this.options.writeGate.reopen();
      }
      if (cause instanceof ActivationError) throw cause;
      throw activationError("ACTIVATION_PREPARE_FAILED", true, cause);
    } finally {
      this.lockHeld = false;
      await lock?.release();
    }
  }

  async cancelPrepare(input: { activationId: string; migrationId: string; userConfirmed: boolean }): Promise<ActivationPrepareResult> {
    if (!input.userConfirmed) throw activationError("ACTIVATION_CANCEL_NOT_ALLOWED", true);
    this.assertLockProvider();
    this.emit("cancelling_prepare");
    let lock: MigrationLockHandle | undefined;
    try {
      lock = await this.options.lockProvider.acquire({ name: MIGRATION_WRITER_LOCK_NAME, migrationId: `activation-cancel:${input.activationId}` });
      this.lockHeld = true;
      if (!await this.options.assertMigrationInactive(input.migrationId)) throw activationError("ACTIVATION_CANCEL_NOT_ALLOWED", false);
      const markerRead = await this.markerStore.read();
      const journal = await this.options.journalRepository.read(input.activationId);
      if (journal?.status === "cancelled" && markerRead.status === "valid" && markerRead.marker.state === "legacy_active") {
        this.options.writeGate.reopen();
        return { status: "prepare_cancelled", activationId: input.activationId, migrationId: input.migrationId, marker: markerRead.marker, idempotent: true, activeBackend: "localStorage", activeStorageSwitched: false };
      }
      if (markerRead.status !== "valid" || markerRead.marker.state !== "activation_prepared" ||
          markerRead.marker.activationId !== input.activationId || markerRead.marker.migrationId !== input.migrationId ||
          journal?.status !== "prepared" || journal.bootstrapRevisionPrepared !== markerRead.marker.revision) {
        this.options.writeGate.markPrepared();
        throw activationError("ACTIVATION_CANCEL_NOT_ALLOWED", false);
      }
      await this.options.journalRepository.transition(input.activationId, ["prepared"], "cancelled", { updatedAt: this.now().toISOString() });
      const legacyMarker = createLegacyActiveMarker(markerRead.marker, this.now().toISOString());
      await this.markerStore.writeExpectedRevision(markerRead.marker.revision, legacyMarker);
      this.options.broadcast.publish({ type: "activation_prepare_cancelled", activationId: input.activationId, revision: legacyMarker.revision });
      this.options.writeGate.reopen();
      this.emit("prepare_cancelled");
      return { status: "prepare_cancelled", activationId: input.activationId, migrationId: input.migrationId, marker: legacyMarker, idempotent: false, activeBackend: "localStorage", activeStorageSwitched: false };
    } catch (cause) {
      if (cause instanceof ActivationError) throw cause;
      throw activationError("ACTIVATION_CANCEL_NOT_ALLOWED", true, cause);
    } finally {
      this.lockHeld = false;
      await lock?.release();
    }
  }

  private async markRecoveryRequired(activationId: string, migrationId: string, errorCode: string): Promise<void> {
    const current = await this.markerStore.read();
    if (current.status !== "valid" || current.marker.state !== "activation_prepared" ||
        current.marker.activationId !== activationId || current.marker.migrationId !== migrationId) return;
    const updatedAt = this.now().toISOString();
    await this.markerStore.writeExpectedRevision(current.marker.revision, {
      ...current.marker,
      revision: current.marker.revision + 1,
      state: "recovery_required",
      updatedAt,
      errorCode
    });
  }

  private assertLockProvider(): void {
    if (this.options.lockProvider.kind !== "web-locks" || this.options.lockProvider.isAvailable?.() === false) {
      throw activationError("ACTIVATION_CAPABILITY_UNAVAILABLE", true);
    }
  }

  private emit(stage: ActivationPrepareStage): void { this.options.onStage?.(stage); }
}

function activationError(code: ConstructorParameters<typeof ActivationError>[0]["code"], recoverable: boolean, cause?: unknown): ActivationError {
  return new ActivationError({ code, recoverable, cause });
}

function safeCode(cause: unknown): string {
  return cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "ACTIVATION_PREPARE_FAILED";
}