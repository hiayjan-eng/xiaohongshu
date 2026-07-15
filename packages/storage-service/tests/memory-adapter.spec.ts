import {
  createMemoryAdapter,
  getRecordPrimaryKey,
  MemoryAdapter,
  STORAGE_ENTITY_NAMES,
  STORE_PRIMARY_KEYS
} from "../src/index";
import { makeSavedItem, makeSetting } from "./fixtures";
import { expectStorageError, TestHarness } from "./test-harness";

export function runMemoryAdapterSpecificTests(harness: TestHarness): void {
  harness.test("MemoryAdapter: persistence=false and capabilities are explicit", async () => {
    const adapter = createMemoryAdapter();
    harness.equal(adapter.kind, "memory", "kind");
    harness.equal(adapter.capabilities.persistence, false, "memory adapter is not persistent");
    harness.equal(adapter.capabilities.transactions, true, "memory adapter supports transactions");
    harness.equal(adapter.capabilities.indexes, true, "memory adapter supports indexes");
    harness.equal(adapter.capabilities.snapshots, true, "memory adapter supports snapshots");
  });

  harness.test("MemoryAdapter: close and reopen keeps same instance data", async () => {
    const adapter = createMemoryAdapter();
    await adapter.open();
    await adapter.put("savedItems", makeSavedItem("saved-001"));
    await adapter.close();
    await adapter.open();
    harness.assert(Boolean(await adapter.get("savedItems", "saved-001")), "same instance keeps in-memory data after close");
  });

  harness.test("MemoryAdapter: new instances do not share data", async () => {
    const first = createMemoryAdapter();
    const second = createMemoryAdapter();
    await first.open();
    await second.open();
    await first.put("savedItems", makeSavedItem("saved-001"));
    harness.equal(await second.get("savedItems", "saved-001"), undefined, "new instance should not share data");
  });

  harness.test("MemoryAdapter: reset clears all stores", async () => {
    const adapter = createMemoryAdapter();
    await adapter.open();
    await adapter.put("savedItems", makeSavedItem("saved-001"));
    await adapter.put("settings", makeSetting("setting-theme"));
    adapter.reset();
    harness.equal((await adapter.getAll("savedItems")).length, 0, "reset savedItems");
    harness.equal((await adapter.getAll("settings")).length, 0, "reset settings");
  });

  harness.test("MemoryAdapter: seed and dump are cloned test helpers", async () => {
    const adapter = createMemoryAdapter();
    const seeded = makeSavedItem("saved-001", { keywords: ["AI"] });
    adapter.seed("savedItems", [seeded]);
    seeded.keywords.push("mutated");
    const dumped = adapter.dump("savedItems");
    harness.deepEqual(dumped[0]?.keywords, ["AI"], "seed should clone input");
    dumped[0]?.keywords.push("dump-mutated");
    harness.deepEqual(adapter.dump("savedItems")[0]?.keywords, ["AI"], "dump should clone output");
  });

  harness.test("MemoryAdapter: transaction writes use a private snapshot", async () => {
    const adapter = createMemoryAdapter();
    await adapter.open();
    await adapter.put("savedItems", makeSavedItem("saved-001", { title: "before" }));
    await expectStorageError(
      harness,
      () =>
        adapter.transaction(["savedItems"], "readwrite", async (tx) => {
          await tx.put("savedItems", makeSavedItem("saved-001", { title: "inside" }));
          const inside = await tx.get("savedItems", "saved-001");
          harness.equal(inside?.title, "inside", "transaction should see private write");
          throw new Error("rollback");
        }),
      "STORAGE_TRANSACTION_FAILED",
      "private snapshot rollback"
    );
    harness.equal((await adapter.get("savedItems", "saved-001"))?.title, "before", "outer store rolled back");
  });

  harness.test("MemoryAdapter: concurrent readwrite transactions are rejected while one is active", async () => {
    const adapter = createMemoryAdapter();
    await adapter.open();
    let release = (): void => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = adapter.transaction(["savedItems"], "readwrite", async () => {
      await wait;
    });

    await expectStorageError(
      harness,
      () => adapter.transaction(["savedItems"], "readwrite", async () => undefined),
      "STORAGE_NOT_SUPPORTED",
      "concurrent transaction"
    );
    release();
    await first;
  });

  harness.test("MemoryAdapter: rejects non JSON-safe records", async () => {
    const adapter = createMemoryAdapter();
    await adapter.open();
    await expectStorageError(
      harness,
      () => adapter.put("savedItems", { ...makeSavedItem("saved-001"), bad: () => undefined } as never),
      "STORAGE_VALIDATION_FAILED",
      "function record"
    );
    await expectStorageError(
      harness,
      () => adapter.put("savedItems", { ...makeSavedItem("saved-001"), bad: Symbol("bad") } as never),
      "STORAGE_VALIDATION_FAILED",
      "symbol record"
    );
    const cyclic: Record<string, unknown> = { ...makeSavedItem("saved-001") };
    cyclic.self = cyclic;
    await expectStorageError(harness, () => adapter.put("savedItems", cyclic as never), "STORAGE_VALIDATION_FAILED", "cyclic record");
    await expectStorageError(
      harness,
      () => adapter.put("savedItems", { ...makeSavedItem("saved-001"), createdAt: new Date() } as never),
      "STORAGE_VALIDATION_FAILED",
      "Date record"
    );
  });

  harness.test("MemoryAdapter: rejects prototype pollution input", async () => {
    const adapter = createMemoryAdapter();
    await adapter.open();
    const polluted = Object.create({ polluted: true }) as Record<string, unknown>;
    Object.assign(polluted, makeSavedItem("saved-001"));
    await expectStorageError(harness, () => adapter.put("savedItems", polluted as never), "STORAGE_VALIDATION_FAILED", "polluted prototype");
  });

  harness.test("MemoryAdapter: clone fallback works when structuredClone is unavailable", async () => {
    const original = globalThis.structuredClone;
    try {
      (globalThis as { structuredClone?: typeof structuredClone }).structuredClone = undefined;
      const adapter = createMemoryAdapter();
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001", { keywords: ["AI"] }));
      const item = await adapter.get("savedItems", "saved-001");
      harness.deepEqual(item?.keywords, ["AI"], "JSON-safe fallback clone");
    } finally {
      (globalThis as { structuredClone?: typeof structuredClone }).structuredClone = original;
    }
  });

  harness.test("MemoryAdapter: primary key config covers all stores", () => {
    for (const store of STORAGE_ENTITY_NAMES) {
      harness.assert(Boolean(STORE_PRIMARY_KEYS[store]), `${store} has primary key config`);
      const record = store === "settings" ? makeSetting("setting-theme") : undefined;
      if (record) {
        harness.equal(getRecordPrimaryKey(store, record as never), record.key, "settings uses key primary key");
      }
    }
  });

  harness.test("MemoryAdapter: constructor schemaVersion is reflected in healthCheck", async () => {
    const adapter = new MemoryAdapter({ schemaVersion: 12 });
    await adapter.open();
    harness.equal(await adapter.getSchemaVersion(), 12, "constructor schemaVersion");
    harness.equal((await adapter.healthCheck()).schemaVersion, 12, "health schemaVersion");
  });
}

export function getMemorySpecificCaseCount(): number {
  return 12;
}
