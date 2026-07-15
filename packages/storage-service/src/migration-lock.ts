import { MigrationExecutionError } from "./migration-executor-errors";

export const MIGRATION_WRITER_LOCK_NAME = "collection-revival:migration-writer";

export interface MigrationLockAcquireOptions {
  name?: string;
  migrationId: string;
  signal?: AbortSignal;
}

export interface MigrationLockHandle {
  readonly name: string;
  readonly migrationId: string;
  readonly acquiredAt: string;
  release(): Promise<void>;
}

export interface MigrationLockProvider {
  acquire(options: MigrationLockAcquireOptions): Promise<MigrationLockHandle>;
}

interface MemoryLockState {
  migrationId: string;
  acquiredAt: string;
}

export class MemoryMigrationLockProvider implements MigrationLockProvider {
  private readonly locks = new Map<string, MemoryLockState>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async acquire(options: MigrationLockAcquireOptions): Promise<MigrationLockHandle> {
    assertNotAborted(options.signal);
    const name = options.name ?? MIGRATION_WRITER_LOCK_NAME;
    if (this.locks.has(name)) {
      throw new MigrationExecutionError({
        code: "MIGRATION_LOCK_UNAVAILABLE",
        message: "Another migration writer lock is already active.",
        recoverable: true
      });
    }

    const state: MemoryLockState = {
      migrationId: options.migrationId,
      acquiredAt: this.now().toISOString()
    };
    this.locks.set(name, state);
    let released = false;

    return {
      name,
      migrationId: options.migrationId,
      acquiredAt: state.acquiredAt,
      release: async () => {
        if (released) return;
        released = true;
        const current = this.locks.get(name);
        if (current?.migrationId === options.migrationId) {
          this.locks.delete(name);
        }
      }
    };
  }

  isLocked(name = MIGRATION_WRITER_LOCK_NAME): boolean {
    return this.locks.has(name);
  }
}

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode?: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown | null) => T | Promise<T>
  ): Promise<T>;
}

export class WebLocksMigrationLockProvider implements MigrationLockProvider {
  constructor(private readonly locks: LockManagerLike, private readonly now: () => Date = () => new Date()) {}

  async acquire(options: MigrationLockAcquireOptions): Promise<MigrationLockHandle> {
    assertNotAborted(options.signal);
    const name = options.name ?? MIGRATION_WRITER_LOCK_NAME;
    let releaseHold = (): void => undefined;
    let released = false;
    let requestSettledWithoutLock = false;

    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const requestPromise = this.locks.request(
      name,
      { mode: "exclusive", ifAvailable: true, signal: options.signal },
      async (lock) => {
        if (!lock) {
          requestSettledWithoutLock = true;
          return;
        }
        await hold;
      }
    );

    await Promise.resolve();
    if (requestSettledWithoutLock) {
      throw new MigrationExecutionError({
        code: "MIGRATION_LOCK_UNAVAILABLE",
        message: "Web Locks could not acquire the migration writer lock.",
        recoverable: true
      });
    }

    const handle: MigrationLockHandle = {
      name,
      migrationId: options.migrationId,
      acquiredAt: this.now().toISOString(),
      release: async () => {
        if (released) return;
        released = true;
        releaseHold();
        await requestPromise.catch(() => undefined);
      }
    };

    requestPromise.catch(() => undefined);
    return handle;
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MigrationExecutionError({
      code: "MIGRATION_CANCELLED",
      message: "Migration was cancelled before acquiring the writer lock.",
      recoverable: true
    });
  }
}
