import { IDBKeyRange as FakeIDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  DEFAULT_INDEXED_DB_SCHEMA_VERSION,
  INDEXED_DB_INDEX_KEY_PATHS,
  INDEXED_DB_TARGET_CAPABILITIES,
  IndexedDbAdapter,
  STORAGE_ENTITY_NAMES,
  STORAGE_INDEXES,
  STORE_PRIMARY_KEYS,
  createIndexedDbAdapter,
  deleteIndexedDbDatabase,
  type StorageEntityName
} from "../src/index";
import { makeActionCard, makeSavedItem, makeSetting } from "./fixtures";
import { runStorageAdapterContractTests } from "./adapter-contract-suite";
import { expectStorageError, TestHarness } from "./test-harness";

let databaseCounter = 0;

export function runIndexedDbAdapterContractTests(harness: TestHarness): void {
  runStorageAdapterContractTests(harness, {
    name: "IndexedDbAdapter",
    createAdapter: () => createTestIndexedDbAdapter(),
    expectedCapabilities: INDEXED_DB_TARGET_CAPABILITIES,
    preservesInsertionOrder: false,
    cleanup: async (adapter) => {
      await adapter.close();
      if (adapter instanceof IndexedDbAdapter) {
        await deleteIndexedDbDatabase(adapter.databaseName, fakeIndexedDB);
      }
    }
  });
}

export function runIndexedDbAdapterSpecificTests(harness: TestHarness): void {
  harness.test("IndexedDbAdapter: isAvailable returns false without IndexedDB", async () => {
    const adapter = createIndexedDbAdapter({
      databaseName: nextDatabaseName("unavailable"),
      indexedDBFactory: undefined,
      keyRangeFactory: undefined
    });
    harness.equal(await adapter.isAvailable(), false, "isAvailable without factory");
    await expectStorageError(harness, () => adapter.open(), "STORAGE_OPEN_FAILED", "open without factory");
  });

  harness.test("IndexedDbAdapter: open creates all stores, keyPaths and indexes", async () => {
    const name = nextDatabaseName("schema");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      const db = await openRawDatabase(name);
      try {
        const storeNames = Array.from(db.objectStoreNames).sort();
        harness.deepEqual(storeNames, [...STORAGE_ENTITY_NAMES].sort(), "all stores created");
        const tx = db.transaction([...STORAGE_ENTITY_NAMES], "readonly");
        for (const storeName of STORAGE_ENTITY_NAMES) {
          const store = tx.objectStore(storeName);
          harness.equal(store.keyPath as string, STORE_PRIMARY_KEYS[storeName], `${storeName} keyPath`);
          const indexNames = Array.from(store.indexNames).sort();
          harness.deepEqual(indexNames, [...STORAGE_INDEXES[storeName]].sort(), `${storeName} indexes`);
          for (const indexName of STORAGE_INDEXES[storeName]) {
            harness.equal(store.index(indexName).keyPath as string, INDEXED_DB_INDEX_KEY_PATHS[storeName][indexName], `${storeName}.${indexName} keyPath`);
          }
        }
        await waitForTransaction(tx);
      } finally {
        db.close();
      }
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: close and reopen persists data in same database", async () => {
    const name = nextDatabaseName("persist");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001"));
      await adapter.close();
      await adapter.open();
      harness.assert(Boolean(await adapter.get("savedItems", "saved-001")), "same adapter reopen reads data");
      await adapter.close();

      const second = createTestIndexedDbAdapter(name);
      await second.open();
      harness.assert(Boolean(await second.get("savedItems", "saved-001")), "new adapter same database reads data");
      await second.close();
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: different database names are isolated", async () => {
    const firstName = nextDatabaseName("isolation-a");
    const secondName = nextDatabaseName("isolation-b");
    const first = createTestIndexedDbAdapter(firstName);
    const second = createTestIndexedDbAdapter(secondName);
    try {
      await first.open();
      await second.open();
      await first.put("savedItems", makeSavedItem("saved-001"));
      harness.equal(await second.get("savedItems", "saved-001"), undefined, "different DB should not share records");
    } finally {
      await first.close();
      await second.close();
      await deleteIndexedDbDatabase(firstName, fakeIndexedDB);
      await deleteIndexedDbDatabase(secondName, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: versionchange closes the old connection", async () => {
    const name = nextDatabaseName("versionchange");
    const adapter = createTestIndexedDbAdapter(name, 1);
    try {
      await adapter.open();
      const upgradeRequest = fakeIndexedDB.open(name, 2);
      upgradeRequest.onupgradeneeded = () => undefined;
      const upgraded = await requestToPromise(upgradeRequest);
      upgraded.close();
      const health = await adapter.healthCheck();
      harness.equal(health.opened, false, "versionchange closed adapter connection");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: blocked open maps to STORAGE_LOCKED", async () => {
    const name = nextDatabaseName("blocked");
    const raw = await openRawDatabase(name, 1);
    const adapter = createTestIndexedDbAdapter(name, 2);
    try {
      await expectStorageError(harness, () => adapter.open(), "STORAGE_LOCKED", "blocked open");
    } finally {
      raw.close();
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: lower version maps to schema mismatch", async () => {
    const name = nextDatabaseName("version-error");
    const newer = await openRawDatabase(name, 2);
    newer.close();
    const adapter = createTestIndexedDbAdapter(name, 1);
    try {
      await expectStorageError(harness, () => adapter.open(), "STORAGE_SCHEMA_MISMATCH", "version error");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: bulkPut failure rolls back the whole transaction", async () => {
    const name = nextDatabaseName("bulk-rollback");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      await expectStorageError(
        harness,
        () => adapter.bulkPut("savedItems", [makeSavedItem("saved-001"), { ...makeSavedItem("saved-002"), id: "" }]),
        "STORAGE_VALIDATION_FAILED",
        "bulkPut invalid primary"
      );
      harness.equal((await adapter.getAll("savedItems")).length, 0, "failed bulkPut should not write any records");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: multi-store transaction is atomic", async () => {
    const name = nextDatabaseName("multi-store-rollback");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      await expectStorageError(
        harness,
        () =>
          adapter.transaction(["savedItems", "actionCards"], "readwrite", async (tx) => {
            await tx.put("savedItems", makeSavedItem("saved-001"));
            await tx.put("actionCards", { ...makeActionCard("action-001"), id: "" });
          }),
        "STORAGE_TRANSACTION_FAILED",
        "multi store rollback"
      );
      harness.equal(await adapter.get("savedItems", "saved-001"), undefined, "failed multi-store transaction should roll back savedItem");
      harness.equal(await adapter.get("actionCards", "action-001"), undefined, "failed multi-store transaction should roll back actionCard");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: healthCheck does not write records", async () => {
    const name = nextDatabaseName("health");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      const before = (await adapter.exportSnapshot()).counts;
      const health = await adapter.healthCheck();
      const after = (await adapter.exportSnapshot()).counts;
      harness.equal(health.adapter, "indexedDB", "health adapter");
      harness.deepEqual(after, before, "healthCheck should not write records");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: default Snapshot excludes internal settings", async () => {
    const name = nextDatabaseName("internal-settings");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      await adapter.put("settings", makeSetting("setting-theme", { key: "theme", internal: false }));
      await adapter.put("settings", makeSetting("setting-dev", { key: "developerMode", category: "internal", internal: true, value: true }));
      const snapshot = await adapter.exportSnapshot({ stores: ["settings"] });
      harness.equal(snapshot.counts.settings, 1, "default excludes internal settings");
      const withInternal = await adapter.exportSnapshot({ stores: ["settings"], includeInternalSettings: true });
      harness.equal(withInternal.counts.settings, 2, "includeInternalSettings exports internal settings");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbAdapter: staging validation failure does not pollute primary database", async () => {
    const name = nextDatabaseName("staging-validation");
    const adapter = createTestIndexedDbAdapter(name);
    try {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-old"));
      const snapshot = {
        formatVersion: 1,
        sourceStorage: "memory" as const,
        sourceSchemaVersion: 1,
        createdAt: "2026-07-15T00:00:00.000Z",
        counts: { savedItems: 1 },
        records: { savedItems: [{ ...makeSavedItem("saved-new"), id: "" }] }
      };
      await expectStorageError(harness, () => adapter.importSnapshot(snapshot, { mode: "staging" }), "STORAGE_VALIDATION_FAILED", "bad staging snapshot");
      harness.assert(Boolean(await adapter.get("savedItems", "saved-old")), "old data remains after failed staging");
      harness.equal(await adapter.get("savedItems", "saved-new"), undefined, "bad staging snapshot did not write incoming");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });
}

export function getIndexedDbSpecificCaseCount(): number {
  return 12;
}

function createTestIndexedDbAdapter(databaseName = nextDatabaseName("contract"), schemaVersion = DEFAULT_INDEXED_DB_SCHEMA_VERSION): IndexedDbAdapter {
  return createIndexedDbAdapter({
    databaseName,
    schemaVersion,
    indexedDBFactory: fakeIndexedDB,
    keyRangeFactory: FakeIDBKeyRange
  });
}

function nextDatabaseName(label: string): string {
  databaseCounter += 1;
  return `collection-revival-storage-test-${label}-${Date.now()}-${databaseCounter}`;
}

function openRawDatabase(name: string, version = DEFAULT_INDEXED_DB_SCHEMA_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.open(name, version);
    request.onupgradeneeded = () => {
      for (const store of STORAGE_ENTITY_NAMES) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath: STORE_PRIMARY_KEYS[store] });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
