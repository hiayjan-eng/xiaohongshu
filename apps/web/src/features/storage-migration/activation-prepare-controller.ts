import {
  ActivationJournalRepository,
  type MigrationExecutionInspection,
  type StorageAdapter
} from "@revival/storage-service";
import {
  ActivationPreparer,
  ActivationSwitcher,
  IndexedDbRuntime,
  StorageBootstrapMarkerStore,
  StorageRuntimeBroadcast,
  StorageWriteGate,
  createBrowserStorageRuntimeBroadcast,
  inspectBrowserActivationCapabilities,
  runActivationPreflight,
  type ActivationPreflightReport,
  type ActivationPreflightResult,
  type ActivationConfirmationValues,
  type ActivationSwitchResult,
  type ActivationSwitchStage,
  type ControlledReloader,
  type ActivationPrepareConfirmations,
  type ActivationPrepareResult,
  type ActivationPrepareStage,
  type BootstrapMarkerStorageLike
} from "@revival/storage-runtime";
import { createReadonlyBrowserStorage } from "./migration-flow-controller";
import {
  MIGRATION_TARGET_DATABASE_NAME,
  MIGRATION_TARGET_SCHEMA_VERSION,
  createBrowserMigrationExecutionRuntime,
  type MigrationExecutionRuntime,
  type MigrationExecutorLike
} from "./migration-execution-runtime";
import {
  createBrowserIndexedDbDatabaseInspector,
  type IndexedDbDatabaseInspector
} from "./migration-database-inspector";

export interface ActivationPrepareControllerOptions {
  executionRuntime?: MigrationExecutionRuntime;
  databaseInspector?: IndexedDbDatabaseInspector;
  markerStorage?: BootstrapMarkerStorageLike;
  readonlyStorageFactory?: typeof createReadonlyBrowserStorage;
  broadcastFactory?: () => StorageRuntimeBroadcast;
  now?: () => Date;
}

export interface ActivationSafeReportDownload {
  blob: Blob;
  filename: string;
}

export class ActivationPrepareController {
  private readonly executionRuntime: MigrationExecutionRuntime;
  private readonly databaseInspector: IndexedDbDatabaseInspector;
  private readonly markerStorage: BootstrapMarkerStorageLike;
  private readonly readonlyStorageFactory: typeof createReadonlyBrowserStorage;
  private readonly broadcastFactory: () => StorageRuntimeBroadcast;
  private readonly now: () => Date;
  private readonly reloader: ControlledReloader;
  private lastPreflight?: ActivationPreflightResult;

  constructor(options: ActivationPrepareControllerOptions = {}) {
    this.executionRuntime = options.executionRuntime ?? createBrowserMigrationExecutionRuntime();
    this.databaseInspector = options.databaseInspector ?? createBrowserIndexedDbDatabaseInspector();
    this.markerStorage = options.markerStorage ?? readBrowserMarkerStorage();
    this.readonlyStorageFactory = options.readonlyStorageFactory ?? createReadonlyBrowserStorage;
    this.broadcastFactory = options.broadcastFactory ?? createBrowserStorageRuntimeBroadcast;
    this.now = options.now ?? (() => new Date());
    this.reloader = options.reloader ?? { reload: () => globalThis.location.reload() };
  }

  async checkConditions(): Promise<ActivationPreflightReport> {
    this.lastPreflight = await this.withActivationSession(async (session) => this.runPreflight(session));
    return this.lastPreflight.report;
  }

  async prepare(
    confirmations: ActivationPrepareConfirmations,
    onStage?: (stage: ActivationPrepareStage) => void
  ): Promise<ActivationPrepareResult> {
    return this.withActivationSession(async (session) => {
      const broadcast = this.broadcastFactory();
      const writeGate = new StorageWriteGate();
      try {
        const preparer = new ActivationPreparer({
          lockProvider: session.lockProvider,
          markerStorage: this.markerStorage,
          journalRepository: session.journals,
          writeGate,
          broadcast,
          flushPendingWrites: async () => undefined,
          runPreflight: async () => {
            const result = await this.runPreflight(session);
            this.lastPreflight = result;
            return result;
          },
          assertMigrationInactive: async (migrationId) => isCompletedInactiveMigration(await session.executor.inspectAll(), migrationId),
          now: this.now,
          onStage
        });
        return await preparer.prepare(confirmations);
      } finally {
        broadcast.close();
      }
    }, true);
  }

  async activate(
    confirmations: ActivationConfirmationValues,
    onStage?: (stage: ActivationSwitchStage) => void
  ): Promise<ActivationSwitchResult> {
    return this.withActivationSession(async (session) => {
      const broadcast = this.broadcastFactory();
      const writeGate = new StorageWriteGate("activation_prepared");
      try {
        const switcher = new ActivationSwitcher({
          lockProvider: session.lockProvider,
          markerStorage: this.markerStorage,
          journalRepository: session.journals,
          writeGate,
          broadcast,
          flushPendingWrites: async () => undefined,
          runFinalPreflight: async () => {
            const result = await this.runPreflight(session);
            this.lastPreflight = result;
            return result;
          },
          reloader: this.reloader,
          now: this.now,
          onStage
        });
        return await switcher.switch(confirmations);
      } finally {
        broadcast.close();
      }
    }, true);
  }

  async cancelPrepare(
    input: { activationId: string; migrationId: string; userConfirmed: boolean },
    onStage?: (stage: ActivationPrepareStage) => void
  ): Promise<ActivationPrepareResult> {
    return this.withActivationSession(async (session) => {
      const broadcast = this.broadcastFactory();
      const writeGate = new StorageWriteGate("activation_prepared");
      try {
        const preparer = new ActivationPreparer({
          lockProvider: session.lockProvider,
          markerStorage: this.markerStorage,
          journalRepository: session.journals,
          writeGate,
          broadcast,
          flushPendingWrites: async () => undefined,
          runPreflight: async () => { throw new Error("Cancel does not run activation preflight."); },
          assertMigrationInactive: async (migrationId) => isCompletedInactiveMigration(await session.executor.inspectAll(), migrationId),
          now: this.now,
          onStage
        });
        return await preparer.cancelPrepare(input);
      } finally {
        broadcast.close();
      }
    }, true);
  }

  prepareSafeReportDownload(report: ActivationPreflightReport): ActivationSafeReportDownload {
    const serialized = JSON.stringify({ formatVersion: 1, report }, null, 2);
    return {
      blob: new Blob([serialized], { type: "application/json;charset=utf-8" }),
      filename: `collection-revival-activation-preflight-${safeDateStamp(report.checkedAt)}.json`
    };
  }

  private async runPreflight(session: ActivationSession): Promise<ActivationPreflightResult> {
    const inspections = await session.executor.inspectAll();
    const completed = inspections.filter((entry) => entry.status === "completed" && entry.metadata?.activeStorageSwitched === false);
    const persistedBackup = completed.length === 1
      ? await session.executor.readPersistedBackup(completed[0].migrationId).catch(() => undefined)
      : undefined;
    const markerRead = await new StorageBootstrapMarkerStore(this.markerStorage).read();
    const journals = await session.journals.list();
    const capabilities = inspectBrowserActivationCapabilities({
      webLocks: this.executionRuntime.isWebLocksAvailable(),
      webCrypto: Boolean(globalThis.crypto?.subtle),
      indexedDB: typeof globalThis.indexedDB !== "undefined",
      indexedDbDatabases: this.databaseInspector.isSupported(),
      broadcastChannel: typeof globalThis.BroadcastChannel !== "undefined",
      storageEvent: typeof globalThis.addEventListener === "function",
      localStorageReadable: canReadLegacyStorage(this.readonlyStorageFactory),
      adapterAvailable: await session.adapter.isAvailable(),
      completedSessionKnowsDatabaseExists: completed.length === 1
    });
    return runActivationPreflight({
      readonlyStorage: this.readonlyStorageFactory(),
      inspections,
      persistedBackup,
      targetAdapter: session.adapter,
      targetRuntime: session.targetRuntime,
      markerRead,
      journals,
      capabilities,
      activationCandidateId: completed.length === 1 ? `candidate-${completed[0].migrationId}` : "candidate-unavailable",
      now: this.now
    });
  }

  private async withActivationSession<T>(operation: (session: ActivationSession) => Promise<T>, requireWebLocks = false): Promise<T> {
    if (!this.databaseInspector.isSupported() || !await this.databaseInspector.exists(MIGRATION_TARGET_DATABASE_NAME)) {
      throw new Error("ACTIVATION_TARGET_DATABASE_NOT_FOUND");
    }
    if (requireWebLocks && !this.executionRuntime.isWebLocksAvailable()) throw new Error("ACTIVATION_CAPABILITY_UNAVAILABLE");
    const adapter = this.executionRuntime.createTargetAdapter();
    const lockProvider = this.executionRuntime.createLockProvider();
    const targetRuntime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION, now: this.now });
    try {
      await adapter.open();
      await targetRuntime.open();
      const executor = this.executionRuntime.createExecutor({
        targetAdapter: adapter,
        lockProvider,
        expectedTargetSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION
      });
      return await operation({ adapter, targetRuntime, executor, journals: new ActivationJournalRepository(adapter), lockProvider });
    } finally {
      await targetRuntime.close().catch(() => undefined);
      await adapter.close().catch(() => undefined);
    }
  }
}

interface ActivationSession {
  adapter: StorageAdapter;
  targetRuntime: IndexedDbRuntime;
  executor: MigrationExecutorLike;
  journals: ActivationJournalRepository;
  lockProvider: ReturnType<MigrationExecutionRuntime["createLockProvider"]>;
}

function isCompletedInactiveMigration(inspections: MigrationExecutionInspection[], migrationId: string): boolean {
  const unresolved = inspections.filter((entry) => entry.status !== "rolled_back");
  return unresolved.length === 1 && unresolved[0].migrationId === migrationId &&
    unresolved[0].status === "completed" && unresolved[0].metadata?.activeStorageSwitched === false;
}

function canReadLegacyStorage(factory: typeof createReadonlyBrowserStorage): boolean {
  try {
    const storage = factory();
    void storage.length;
    return true;
  } catch {
    return false;
  }
}

function readBrowserMarkerStorage(): BootstrapMarkerStorageLike {
  if (typeof globalThis.localStorage === "undefined") throw new Error("ACTIVATION_MARKER_STORAGE_UNAVAILABLE");
  return globalThis.localStorage;
}

function safeDateStamp(value: string): string {
  const date = new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}