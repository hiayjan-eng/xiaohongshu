import {
  DEFAULT_INDEXED_DB_NAME,
  DEFAULT_INDEXED_DB_SCHEMA_VERSION,
  IndexedDbAdapter,
  MigrationExecutor,
  WebLocksMigrationLockProvider,
  type LockManagerLike,
  type MigrationExecutionOptions,
  type MigrationExecutionResult,
  type MigrationLockProvider,
  type StorageAdapter
} from "@revival/storage-service";

export const MIGRATION_TARGET_DATABASE_NAME = DEFAULT_INDEXED_DB_NAME;
export const MIGRATION_TARGET_SCHEMA_VERSION = DEFAULT_INDEXED_DB_SCHEMA_VERSION;

export interface MigrationExecutorLike {
  execute(input: Parameters<MigrationExecutor["execute"]>[0]): Promise<MigrationExecutionResult>;
}

export interface MigrationExecutionRuntime {
  isWebLocksAvailable(): boolean;
  createTargetAdapter(): StorageAdapter;
  createLockProvider(): MigrationLockProvider;
  createExecutor(options: MigrationExecutionOptions): MigrationExecutorLike;
  createAbortController(): AbortController;
}

export function createBrowserMigrationExecutionRuntime(): MigrationExecutionRuntime {
  return {
    isWebLocksAvailable: () => Boolean(readBrowserLockManager()),
    createTargetAdapter: () => new IndexedDbAdapter({
      databaseName: MIGRATION_TARGET_DATABASE_NAME,
      schemaVersion: MIGRATION_TARGET_SCHEMA_VERSION
    }),
    createLockProvider: () => {
      const locks = readBrowserLockManager();
      if (!locks) throw new Error("Browser Web Locks are unavailable.");
      return new WebLocksMigrationLockProvider(locks);
    },
    createExecutor: (options) => new MigrationExecutor(options),
    createAbortController: () => new AbortController()
  };
}

function readBrowserLockManager(): LockManagerLike | undefined {
  const browserNavigator = typeof globalThis.navigator === "undefined"
    ? undefined
    : globalThis.navigator as Navigator & { locks?: LockManagerLike };
  return browserNavigator?.locks && typeof browserNavigator.locks.request === "function"
    ? browserNavigator.locks
    : undefined;
}
