import {
  MIGRATION_WRITER_LOCK_NAME,
  MemoryMigrationLockProvider,
  WebLocksMigrationLockProvider
} from "../src/index";
import { expectStorageError, TestHarness } from "./test-harness";

const CASE_COUNT = 6;

export function runMigrationLockTests(harness: TestHarness): void {
  harness.test("Migration lock: Memory provider is exclusive and releases cleanly", async () => {
    const provider = new MemoryMigrationLockProvider({ now: () => new Date("2026-07-15T00:00:00.000Z") });
    const first = await provider.acquire({ migrationId: "migration-001" });
    harness.equal(first.name, MIGRATION_WRITER_LOCK_NAME, "default lock name");
    harness.equal(provider.isLocked(), true, "lock held");
    await expectStorageError(
      harness,
      () => provider.acquire({ migrationId: "migration-002" }),
      "MIGRATION_LOCK_UNAVAILABLE",
      "second lock rejected"
    );
    await first.release();
    harness.equal(provider.isLocked(), false, "lock released");
    await (await provider.acquire({ migrationId: "migration-003" })).release();
  });

  harness.test("Migration lock: Memory release is idempotent", async () => {
    const provider = new MemoryMigrationLockProvider();
    const lock = await provider.acquire({ migrationId: "migration-001" });
    await lock.release();
    await lock.release();
    harness.equal(provider.isLocked(), false, "second release is safe");
  });

  harness.test("Migration lock: abort before acquire is reported as cancellation", async () => {
    const provider = new MemoryMigrationLockProvider();
    const controller = new AbortController();
    controller.abort();
    await expectStorageError(
      harness,
      () => provider.acquire({ migrationId: "migration-001", signal: controller.signal }),
      "MIGRATION_CANCELLED",
      "aborted lock acquire"
    );
  });

  harness.test("Migration lock: Web Locks provider reports unavailable lock", async () => {
    const provider = new WebLocksMigrationLockProvider({
      async request<T>(_name: string, _options: unknown, callback: (lock: unknown | null) => T | Promise<T>): Promise<T> {
        return callback(null);
      }
    });
    await expectStorageError(
      harness,
      () => provider.acquire({ migrationId: "migration-001" }),
      "MIGRATION_LOCK_UNAVAILABLE",
      "web lock unavailable"
    );
  });

  harness.test("Migration lock: Web Locks provider holds until release", async () => {
    let callbackCompleted = false;
    const provider = new WebLocksMigrationLockProvider({
      async request<T>(_name: string, _options: unknown, callback: (lock: unknown | null) => T | Promise<T>): Promise<T> {
        const result = await callback({ name: "lock" });
        callbackCompleted = true;
        return result;
      }
    }, () => new Date("2026-07-15T00:00:00.000Z"));
    const lock = await provider.acquire({ migrationId: "migration-001" });
    harness.equal(lock.acquiredAt, "2026-07-15T00:00:00.000Z", "acquiredAt");
    harness.equal(callbackCompleted, false, "callback still held");
    await lock.release();
    harness.equal(callbackCompleted, true, "callback completed after release");
  });

  harness.test("Migration lock: Web Locks ifAvailable request omits the incompatible signal option", async () => {
    let receivedOptions: { mode?: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal } | undefined;
    const provider = new WebLocksMigrationLockProvider({
      async request<T>(
        _name: string,
        options: { mode?: "exclusive"; ifAvailable?: boolean; signal?: AbortSignal },
        callback: (lock: unknown | null) => T | Promise<T>
      ): Promise<T> {
        receivedOptions = options;
        return callback(null);
      }
    });
    const controller = new AbortController();
    await expectStorageError(
      harness,
      () => provider.acquire({ migrationId: "migration-001", signal: controller.signal }),
      "MIGRATION_LOCK_UNAVAILABLE",
      "web lock unavailable"
    );
    harness.equal(receivedOptions?.mode, "exclusive", "exclusive mode");
    harness.equal(receivedOptions?.ifAvailable, true, "non-queued acquisition");
    harness.equal("signal" in (receivedOptions ?? {}), false, "signal omitted with ifAvailable");
  });
}

export function getMigrationLockCaseCount(): number {
  return CASE_COUNT;
}
