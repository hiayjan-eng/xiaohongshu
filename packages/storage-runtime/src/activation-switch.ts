import {
  MIGRATION_WRITER_LOCK_NAME,
  ActivationJournalRepository,
  type MigrationLockHandle,
  type MigrationLockProvider
} from "@revival/storage-service";
import { ActivationError } from "./activation-errors";
import {
  StorageBootstrapMarkerStore,
  createActivatingMarker,
  type BootstrapMarkerStorageLike,
  type StorageBootstrapMarkerV1
} from "./bootstrap-marker";
import type { ActivationPreflightResult } from "./activation-preflight";
import type { StorageRuntimeBroadcast } from "./runtime-broadcast";
import type { StorageWriteGate } from "./write-gate";

export interface ActivationConfirmationValues {
  indexedDbOnlyWrites: boolean;
  legacyRetainedReadOnly: boolean;
  noDirectMigrationRollback: boolean;
  recoveryOnBootFailure: boolean;
}

export type ActivationSwitchStage =
  | "acquiring_activation_lock"
  | "final_rechecking"
  | "writing_switch_journal"
  | "writing_activating_marker"
  | "reloading";

export interface ControlledReloader { reload(): void; }

export type ActivationSwitchFaultPoint =
  | "after_journal_switching"
  | "after_marker_activating"
  | "before_reload";

export interface ActivationSwitchFaultInjector {
  inject?(point: ActivationSwitchFaultPoint): Promise<void> | void;
}

export interface ActivationSwitcherOptions {
  lockProvider: MigrationLockProvider;
  markerStorage: BootstrapMarkerStorageLike;
  journalRepository: ActivationJournalRepository;
  writeGate: StorageWriteGate;
  broadcast: StorageRuntimeBroadcast;
  flushPendingWrites: () => Promise<void>;
  runFinalPreflight: () => Promise<ActivationPreflightResult>;
  reloader: ControlledReloader;
  now?: () => Date;
  onStage?: (stage: ActivationSwitchStage) => void;
  faultInjector?: ActivationSwitchFaultInjector;
}

export interface ActivationSwitchResult {
  status: "reloading";
  activationId: string;
  migrationId: string;
  marker: StorageBootstrapMarkerV1;
  activeStorageSwitched: false;
}

export class ActivationSwitcher {
  private readonly markerStore: StorageBootstrapMarkerStore;
  private readonly now: () => Date;
  private lockHeld = false;
  private inFlight?: Promise<ActivationSwitchResult>;

  constructor(private readonly options: ActivationSwitcherOptions) {
    this.now = options.now ?? (() => new Date());
    this.markerStore = new StorageBootstrapMarkerStore(options.markerStorage, { assertWriteLockHeld: () => this.lockHeld });
  }

  switch(confirmations: ActivationConfirmationValues): Promise<ActivationSwitchResult> {
    if (!Object.values(confirmations).every(Boolean)) {
      throw activationError("ACTIVATION_CONFIRMATION_REQUIRED", true);
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performSwitch().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async performSwitch(): Promise<ActivationSwitchResult> {
    this.assertLockProvider();
    this.emit("acquiring_activation_lock");
    let lock: MigrationLockHandle | undefined;
    let activationId = "activation-unavailable";
    let migrationId = "migration-unavailable";
    let journalSwitching = false;
    let activatingMarker: StorageBootstrapMarkerV1 | undefined;
    try {
      lock = await this.options.lockProvider.acquire({
        name: MIGRATION_WRITER_LOCK_NAME,
        migrationId: `activation-switch:${this.now().getTime()}`
      });
      this.lockHeld = true;
      this.options.writeGate.markPrepared();
      await this.options.flushPendingWrites().catch((cause) => {
        throw activationError("ACTIVATION_FINAL_RECHECK_FAILED", true, cause);
      });

      this.emit("final_rechecking");
      const preflight = await this.options.runFinalPreflight();
      if (!preflight.report.eligible || !preflight.evidence) {
        throw activationError("ACTIVATION_FINAL_RECHECK_FAILED", true);
      }
      const markerRead = await this.markerStore.read();
      const marker = markerRead.status === "valid" ? markerRead.marker : undefined;
      activationId = preflight.report.activationCandidateId;
      migrationId = preflight.report.migrationId;
      const journal = await this.options.journalRepository.read(activationId);
      if (!marker || marker.state !== "activation_prepared" || marker.activeBackend !== "localStorage" ||
          marker.activationId !== activationId || marker.migrationId !== migrationId ||
          journal?.status !== "prepared" || journal.bootstrapRevisionPrepared !== marker.revision ||
          preflight.evidence.marker?.revision !== marker.revision) {
        throw activationError("ACTIVATION_FINAL_RECHECK_FAILED", false);
      }

      this.emit("writing_switch_journal");
      const switchedAt = this.now().toISOString();
      await this.options.journalRepository.transition(activationId, ["prepared"], "switching", { updatedAt: switchedAt });
      journalSwitching = true;
      await this.inject("after_journal_switching");

      this.emit("writing_activating_marker");
      activatingMarker = createActivatingMarker(marker, this.now().toISOString());
      await this.markerStore.writeExpectedRevision(marker.revision, activatingMarker);
      await this.options.journalRepository.transition(activationId, ["switching"], "switching", {
        updatedAt: this.now().toISOString(),
        markerRevisionActivating: activatingMarker.revision
      });
      await this.inject("after_marker_activating");
      this.options.writeGate.markSwitching();
      this.options.broadcast.publish({
        type: "storage_activation_started",
        activationId,
        revision: activatingMarker.revision
      });
      this.emit("reloading");
    } catch (cause) {
      if (journalSwitching && !activatingMarker) {
        await this.options.journalRepository.transition(activationId, ["switching"], "activation_failed", {
          updatedAt: this.now().toISOString(),
          errorCode: safeCode(cause)
        }).catch(() => undefined);
        await this.markRecoveryRequired(activationId, migrationId, safeCode(cause)).catch(() => undefined);
      }
      if (cause instanceof ActivationError) throw cause;
      throw activationError(journalSwitching ? "ACTIVATION_MARKER_SWITCH_FAILED" : "ACTIVATION_FINAL_RECHECK_FAILED", true, cause);
    } finally {
      this.lockHeld = false;
      await lock?.release();
    }

    await this.inject("before_reload");
    try {
      this.options.reloader.reload();
    } catch (cause) {
      throw activationError("ACTIVATION_RELOAD_REQUIRED", true, cause);
    }
    return { status: "reloading", activationId, migrationId, marker: activatingMarker!, activeStorageSwitched: false };
  }

  private async markRecoveryRequired(activationId: string, migrationId: string, errorCode: string): Promise<void> {
    const current = await this.markerStore.read();
    if (current.status !== "valid" || current.marker.state !== "activation_prepared" ||
        current.marker.activationId !== activationId || current.marker.migrationId !== migrationId) return;
    await this.markerStore.writeExpectedRevision(current.marker.revision, {
      ...current.marker,
      revision: current.marker.revision + 1,
      state: "recovery_required",
      activeBackend: "localStorage",
      updatedAt: this.now().toISOString(),
      errorCode
    });
  }

  private assertLockProvider(): void {
    if (this.options.lockProvider.kind !== "web-locks" || this.options.lockProvider.isAvailable?.() === false) {
      throw activationError("ACTIVATION_CAPABILITY_UNAVAILABLE", true);
    }
  }
  private emit(stage: ActivationSwitchStage): void { this.options.onStage?.(stage); }
  private async inject(point: ActivationSwitchFaultPoint): Promise<void> { await this.options.faultInjector?.inject?.(point); }
}

function activationError(code: ConstructorParameters<typeof ActivationError>[0]["code"], recoverable: boolean, cause?: unknown): ActivationError {
  return new ActivationError({ code, recoverable, cause });
}
function safeCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "ACTIVATION_MARKER_SWITCH_FAILED";
}