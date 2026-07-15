import {
  STORAGE_ENTITY_NAMES,
  STORE_PRIMARY_KEYS,
  type StorageAdapter,
  type StorageCapabilities,
  type StorageEntityName,
  type StorageImportOptions,
  type StorageRecordMap,
  type StorageSnapshot
} from "../src/contracts";
import { StorageError } from "../src/errors";
import {
  FIXTURE_DATES,
  makeActionCard,
  makeAllStoreRecords,
  makeImportBatch,
  makeImportBatchItem,
  makeRecordForStore,
  makeSavedItem,
  makeSetting,
  makeSmartAlbum
} from "./fixtures";
import { expectStorageError, TestHarness } from "./test-harness";

export interface AdapterContractOptions {
  name: string;
  createAdapter: () => StorageAdapter;
  expectedCapabilities: StorageCapabilities;
  cleanup?: (adapter: StorageAdapter) => Promise<void> | void;
}

export function runStorageAdapterContractTests(harness: TestHarness, options: AdapterContractOptions): void {
  const withAdapter = async (run: (adapter: StorageAdapter) => Promise<void>): Promise<void> => {
    const adapter = options.createAdapter();
    try {
      await run(adapter);
    } finally {
      await options.cleanup?.(adapter);
    }
  };

  harness.test(`${options.name}: exposes expected capabilities`, async () => {
    const adapter = options.createAdapter();
    harness.deepEqual(adapter.capabilities, options.expectedCapabilities, "capabilities should match contract");
    await options.cleanup?.(adapter);
  });

  harness.test(`${options.name}: isAvailable and open are idempotent`, async () => {
    await withAdapter(async (adapter) => {
      harness.equal(await adapter.isAvailable(), true, "adapter should be available");
      await adapter.open();
      await adapter.open();
      const health = await adapter.healthCheck();
      harness.equal(health.adapter, adapter.kind, "health adapter");
      harness.equal(health.available, true, "health available");
      harness.equal(health.opened, true, "health opened after open");
      harness.equal(health.writable, true, "health writable after open");
      harness.deepEqual(health.capabilities, adapter.capabilities, "health capabilities");
      harness.assert(!("records" in health), "healthCheck must not expose records");
    });
  });

  harness.test(`${options.name}: close is idempotent and closed operations fail`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.close();
      await adapter.close();
      const health = await adapter.healthCheck();
      harness.equal(health.opened, false, "health opened after close");
      await expectStorageError(harness, () => adapter.get("savedItems", "missing"), "STORAGE_UNAVAILABLE", "closed get");
    });
  });

  harness.test(`${options.name}: schemaVersion is stable`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      const first = await adapter.getSchemaVersion();
      const second = await adapter.getSchemaVersion();
      harness.equal(first, second, "schemaVersion should be stable");
      harness.assert(typeof first === "number" && first >= 0, "schemaVersion should be non-negative");
    });
  });

  harness.test(`${options.name}: put + get round trip every store`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      for (const store of STORAGE_ENTITY_NAMES) {
        const record = makeRecordForStore(store);
        await adapter.put(store, record);
        const saved = await adapter.get(store, getPrimaryKeyForFixture(store, record));
        harness.deepEqual(saved, record, `${store} should round trip`);
      }
    });
  });

  harness.test(`${options.name}: put overwrites same primary key`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001", { title: "first" }));
      await adapter.put("savedItems", makeSavedItem("saved-001", { title: "second" }));
      const saved = await adapter.get("savedItems", "saved-001");
      harness.equal(saved?.title, "second", "same primary key should overwrite");
      harness.equal((await adapter.getAll("savedItems")).length, 1, "overwrite should not duplicate");
    });
  });

  harness.test(`${options.name}: input and returned objects are isolated`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      const input = makeSavedItem("saved-001", { keywords: ["AI"] });
      await adapter.put("savedItems", input);
      input.keywords.push("mutated");
      const firstRead = await adapter.get("savedItems", "saved-001");
      harness.deepEqual(firstRead?.keywords, ["AI"], "mutating input should not mutate stored record");
      if (firstRead) firstRead.keywords.push("read-mutated");
      const secondRead = await adapter.get("savedItems", "saved-001");
      harness.deepEqual(secondRead?.keywords, ["AI"], "mutating returned record should not mutate stored record");
    });
  });

  harness.test(`${options.name}: get missing returns undefined`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      const missing = await adapter.get("savedItems", "missing");
      harness.equal(missing, undefined, "missing record should be undefined");
    });
  });

  harness.test(`${options.name}: getAll supports insertion order, ordering, limit and offset`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.bulkPut("savedItems", [
        makeSavedItem("saved-b", { title: "Beta", updatedAt: "2026-07-15T02:00:00.000Z" }),
        makeSavedItem("saved-a", { title: "Alpha", updatedAt: "2026-07-15T01:00:00.000Z" }),
        makeSavedItem("saved-c", { title: "Gamma", updatedAt: "2026-07-15T03:00:00.000Z" })
      ]);
      harness.deepEqual((await adapter.getAll("savedItems")).map((item) => item.id), ["saved-b", "saved-a", "saved-c"], "default getAll order");
      harness.deepEqual(
        (await adapter.getAll("savedItems", { orderBy: "updatedAt", direction: "desc", offset: 1, limit: 1 })).map((item) => item.id),
        ["saved-b"],
        "ordered paging"
      );
      harness.deepEqual(await adapter.getAll("savedItems", { limit: 0 }), [], "limit zero returns empty");
      await expectStorageError(harness, () => adapter.getAll("savedItems", { limit: -1 }), "STORAGE_VALIDATION_FAILED", "negative limit");
      await expectStorageError(harness, () => adapter.getAll("savedItems", { orderBy: "createdAt" as never }), "STORAGE_VALIDATION_FAILED", "invalid getAll orderBy");
    });
  });

  harness.test(`${options.name}: delete and clear are store-scoped`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001"));
      await adapter.put("actionCards", makeActionCard("action-001"));
      await adapter.delete("savedItems", "missing");
      await adapter.delete("savedItems", "saved-001");
      harness.equal(await adapter.get("savedItems", "saved-001"), undefined, "deleted record missing");
      harness.assert(Boolean(await adapter.get("actionCards", "action-001")), "other store untouched");
      await adapter.put("savedItems", makeSavedItem("saved-002"));
      await adapter.clear("savedItems");
      harness.equal((await adapter.getAll("savedItems")).length, 0, "clear target store");
      harness.equal((await adapter.getAll("actionCards")).length, 1, "clear does not affect other stores");
    });
  });

  harness.test(`${options.name}: bulkPut writes atomically and reports counts`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      const empty = await adapter.bulkPut("savedItems", []);
      harness.deepEqual(empty, { attempted: 0, written: 0, skipped: 0, failed: 0 }, "empty bulkPut result");

      const result = await adapter.bulkPut("savedItems", [makeSavedItem("saved-001"), makeSavedItem("saved-002")]);
      harness.deepEqual(result, { attempted: 2, written: 2, skipped: 0, failed: 0 }, "bulkPut result");
      harness.equal((await adapter.getAll("savedItems")).length, 2, "bulkPut writes records");

      await expectStorageError(
        harness,
        () => adapter.bulkPut("savedItems", [makeSavedItem("saved-003"), { ...makeSavedItem("saved-004"), id: "" }]),
        "STORAGE_VALIDATION_FAILED",
        "bulkPut missing primary"
      );
      harness.equal(await adapter.get("savedItems", "saved-003"), undefined, "failed bulkPut should not partially write");

      await expectStorageError(
        harness,
        () => adapter.bulkPut("savedItems", [makeSavedItem("saved-005"), makeSavedItem("saved-005")]),
        "STORAGE_DUPLICATE_KEY",
        "bulkPut duplicate primary"
      );
      harness.equal(await adapter.get("savedItems", "saved-005"), undefined, "duplicate bulkPut should be atomic");
    });
  });

  harness.test(`${options.name}: single-index query supports equals`, async () => {
    await withAdapter(async (adapter) => {
      await seedQueryItems(adapter);
      const results = await adapter.query("savedItems", { index: "contentDomain", equals: "AI 与效率" as never });
      harness.deepEqual(results.map((item) => item.id), ["saved-001", "saved-003"], "equals query");
      const noSourceId = await adapter.query("savedItems", { index: "sourceItemId", equals: "source-001" });
      harness.deepEqual(noSourceId.map((item) => item.id), ["saved-001"], "sourceItemId alias query");
    });
  });

  harness.test(`${options.name}: single-index query supports ranges and boundaries`, async () => {
    await withAdapter(async (adapter) => {
      await seedQueryItems(adapter);
      harness.deepEqual(
        (await adapter.query("savedItems", { index: "updatedAt", lowerBound: "2026-07-15T02:00:00.000Z" })).map((item) => item.id),
        ["saved-002", "saved-003"],
        "lowerBound inclusive default"
      );
      harness.deepEqual(
        (await adapter.query("savedItems", { index: "updatedAt", lowerBound: "2026-07-15T02:00:00.000Z", includeLower: false })).map((item) => item.id),
        ["saved-003"],
        "lowerBound exclusive"
      );
      harness.deepEqual(
        (await adapter.query("savedItems", { index: "updatedAt", upperBound: "2026-07-15T02:00:00.000Z", includeUpper: false })).map((item) => item.id),
        ["saved-001"],
        "upperBound exclusive"
      );
    });
  });

  harness.test(`${options.name}: query supports direction, offset, limit and stable sorting`, async () => {
    await withAdapter(async (adapter) => {
      await seedQueryItems(adapter);
      const results = await adapter.query("savedItems", { index: "contentDomain", lowerBound: "", direction: "desc", offset: 1, limit: 2 });
      harness.deepEqual(results.map((item) => item.id), ["saved-003", "saved-001"], "direction offset limit");
      const tieResults = await adapter.query("savedItems", { index: "contentDomain", equals: "AI 与效率" as never });
      harness.deepEqual(tieResults.map((item) => item.id), ["saved-001", "saved-003"], "tie sorted by primary key");
    });
  });

  harness.test(`${options.name}: query rejects invalid combinations and indexes`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await expectStorageError(harness, () => adapter.query("savedItems", { index: "createdAt" as never, equals: FIXTURE_DATES.now }), "STORAGE_VALIDATION_FAILED", "invalid index");
      await expectStorageError(
        harness,
        () => adapter.query("savedItems", { index: "updatedAt", equals: FIXTURE_DATES.now, lowerBound: FIXTURE_DATES.now }),
        "STORAGE_VALIDATION_FAILED",
        "equals and range conflict"
      );
      await expectStorageError(harness, () => adapter.query("savedItems", { equals: "AI" as never }), "STORAGE_VALIDATION_FAILED", "filter without index");
      await expectStorageError(harness, () => adapter.query("savedItems", { index: "updatedAt", offset: -1 }), "STORAGE_VALIDATION_FAILED", "negative query offset");
    });
  });

  harness.test(`${options.name}: query results are isolated`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001", { keywords: ["AI"] }));
      const results = await adapter.query("savedItems", { index: "contentDomain", equals: "AI 与效率" as never });
      results[0]?.keywords.push("mutated");
      const again = await adapter.get("savedItems", "saved-001");
      harness.deepEqual(again?.keywords, ["AI"], "query result mutation should not mutate store");
    });
  });

  harness.test(`${options.name}: readonly transaction can read but cannot write`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001"));
      const title = await adapter.transaction(["savedItems"], "readonly", async (tx) => {
        const item = await tx.get("savedItems", "saved-001");
        await expectStorageError(harness, () => tx.put("savedItems", makeSavedItem("saved-002")), "STORAGE_TRANSACTION_FAILED", "readonly write");
        return item?.title;
      });
      harness.equal(title, "测试收藏 saved-001", "readonly transaction return value");
      harness.equal(await adapter.get("savedItems", "saved-002"), undefined, "readonly failed write should not persist");
    });
  });

  harness.test(`${options.name}: readwrite transaction commits and returns operation result`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      const result = await adapter.transaction(["savedItems"], "readwrite", async (tx) => {
        await tx.put("savedItems", makeSavedItem("saved-001"));
        return "committed";
      });
      harness.equal(result, "committed", "transaction return value");
      harness.assert(Boolean(await adapter.get("savedItems", "saved-001")), "transaction write committed");
    });
  });

  harness.test(`${options.name}: failed readwrite transaction rolls back`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001", { title: "before" }));
      await expectStorageError(
        harness,
        () => adapter.transaction(["savedItems"], "readwrite", async (tx) => {
          await tx.put("savedItems", makeSavedItem("saved-001", { title: "inside" }));
          throw new Error("boom");
        }),
        "STORAGE_TRANSACTION_FAILED",
        "transaction rollback"
      );
      harness.equal((await adapter.get("savedItems", "saved-001"))?.title, "before", "failed transaction rolled back");
    });
  });

  harness.test(`${options.name}: transactions are scoped to declared stores`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await expectStorageError(
        harness,
        () => adapter.transaction(["savedItems"], "readonly", async (tx) => tx.get("actionCards", "action-001")),
        "STORAGE_TRANSACTION_FAILED",
        "transaction undeclared store"
      );
    });
  });

  harness.test(`${options.name}: multi-store transaction commits atomically`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.transaction(["savedItems", "actionCards"], "readwrite", async (tx) => {
        await tx.put("savedItems", makeSavedItem("saved-001"));
        await tx.put("actionCards", makeActionCard("action-001"));
      });
      harness.assert(Boolean(await adapter.get("savedItems", "saved-001")), "multi-store savedItem committed");
      harness.assert(Boolean(await adapter.get("actionCards", "action-001")), "multi-store actionCard committed");

      await expectStorageError(
        harness,
        () => adapter.transaction(["savedItems", "actionCards"], "readwrite", async (tx) => {
          await tx.put("savedItems", makeSavedItem("saved-002"));
          await tx.put("actionCards", { ...makeActionCard("action-002"), id: "" });
        }),
        "STORAGE_TRANSACTION_FAILED",
        "multi-store rollback"
      );
      harness.equal(await adapter.get("savedItems", "saved-002"), undefined, "multi-store failure rolled back savedItem");
      harness.equal(await adapter.get("actionCards", "action-002"), undefined, "multi-store failure rolled back actionCard");
    });
  });

  harness.test(`${options.name}: nested transaction is rejected`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await expectStorageError(
        harness,
        () => adapter.transaction(["savedItems"], "readonly", async () => adapter.transaction(["savedItems"], "readonly", async () => undefined)),
        "STORAGE_TRANSACTION_FAILED",
        "nested transaction"
      );
    });
  });

  harness.test(`${options.name}: exportSnapshot supports full and partial stores`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001"));
      await adapter.put("actionCards", makeActionCard("action-001"));
      const full = await adapter.exportSnapshot();
      harness.equal(full.sourceStorage, adapter.kind, "snapshot sourceStorage");
      harness.equal(full.sourceSchemaVersion, await adapter.getSchemaVersion(), "snapshot schemaVersion");
      harness.assert(typeof full.createdAt === "string" && !Number.isNaN(Date.parse(full.createdAt)), "snapshot createdAt ISO");
      harness.equal(full.counts.savedItems, 1, "snapshot savedItems count");
      harness.equal(full.counts.actionCards, 1, "snapshot actionCards count");
      harness.assert(JSON.stringify(full).length > 0, "snapshot is JSON-safe");

      const partial = await adapter.exportSnapshot({ stores: ["savedItems"] });
      harness.deepEqual(Object.keys(partial.records), ["savedItems"], "partial snapshot records");
      harness.deepEqual(Object.keys(partial.counts), ["savedItems"], "partial snapshot counts");
    });
  });

  harness.test(`${options.name}: exported snapshots are isolated and exclude internal settings by default`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("settings", makeSetting("setting-theme", { key: "theme", internal: false }));
      await adapter.put("settings", makeSetting("setting-dev", { key: "developerMode", category: "internal", internal: true, value: true }));
      const snapshot = await adapter.exportSnapshot({ stores: ["settings"] });
      harness.equal(snapshot.counts.settings, 1, "internal settings excluded");
      harness.equal(snapshot.records.settings?.[0]?.key, "theme", "visible setting exported");
      snapshot.records.settings?.push(makeSetting("setting-extra", { key: "extra" }));
      const again = await adapter.exportSnapshot({ stores: ["settings"] });
      harness.equal(again.counts.settings, 1, "mutating snapshot should not affect adapter");

      const withInternal = await adapter.exportSnapshot({ stores: ["settings"], includeInternalSettings: true });
      harness.equal(withInternal.counts.settings, 2, "internal settings opt-in");
      harness.assert(!("extensionScanCheckpoint" in withInternal.records), "snapshot should not include extension stores");
    });
  });

  harness.test(`${options.name}: import preview validates without writing`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      const snapshot = makeSnapshot({ savedItems: [makeSavedItem("saved-001")] });
      const result = await adapter.importSnapshot(snapshot, { mode: "preview" });
      harness.equal(result.attempted.savedItems, 1, "preview attempted");
      harness.equal(result.written.savedItems, 1, "preview would write");
      harness.equal(result.rollbackAvailable, false, "preview rollbackAvailable");
      harness.equal(await adapter.get("savedItems", "saved-001"), undefined, "preview does not write");
    });
  });

  harness.test(`${options.name}: import merge respects preserveExisting`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-001", { title: "existing" }));
      const snapshot = makeSnapshot({ savedItems: [makeSavedItem("saved-001", { title: "incoming" }), makeSavedItem("saved-002")] });
      const preserved = await adapter.importSnapshot(snapshot, { mode: "merge", preserveExisting: true });
      harness.equal(preserved.skipped.savedItems, 1, "merge preserved skipped count");
      harness.equal((await adapter.get("savedItems", "saved-001"))?.title, "existing", "merge preserveExisting keeps old value");
      harness.assert(Boolean(await adapter.get("savedItems", "saved-002")), "merge writes new value");

      const overwritten = await adapter.importSnapshot(makeSnapshot({ savedItems: [makeSavedItem("saved-001", { title: "incoming" })] }), {
        mode: "merge",
        preserveExisting: false
      });
      harness.equal(overwritten.written.savedItems, 1, "merge overwrite write count");
      harness.equal((await adapter.get("savedItems", "saved-001"))?.title, "incoming", "merge overwrite value");
    });
  });

  harness.test(`${options.name}: import replace only replaces included stores`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-old"));
      await adapter.put("actionCards", makeActionCard("action-001"));
      await adapter.importSnapshot(makeSnapshot({ savedItems: [makeSavedItem("saved-new")] }), { mode: "replace" });
      harness.equal(await adapter.get("savedItems", "saved-old"), undefined, "replace clears included store");
      harness.assert(Boolean(await adapter.get("savedItems", "saved-new")), "replace writes new record");
      harness.assert(Boolean(await adapter.get("actionCards", "action-001")), "replace does not clear missing store");
    });
  });

  harness.test(`${options.name}: import staging succeeds atomically`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-old"));
      const result = await adapter.importSnapshot(makeSnapshot({ savedItems: [makeSavedItem("saved-new")] }), { mode: "staging" });
      harness.equal(result.rollbackAvailable, true, "staging rollbackAvailable");
      harness.equal(await adapter.get("savedItems", "saved-old"), undefined, "staging replaces included store");
      harness.assert(Boolean(await adapter.get("savedItems", "saved-new")), "staging writes new record");
    });
  });

  harness.test(`${options.name}: failed staging leaves current data untouched`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await adapter.put("savedItems", makeSavedItem("saved-old"));
      const invalid = makeSnapshot({ savedItems: [makeSavedItem("saved-new")] });
      invalid.records.savedItems = [{ ...makeSavedItem("saved-new"), id: "" }];
      await expectStorageError(harness, () => adapter.importSnapshot(invalid, { mode: "staging" }), "STORAGE_VALIDATION_FAILED", "invalid staging");
      harness.assert(Boolean(await adapter.get("savedItems", "saved-old")), "failed staging keeps old record");
      harness.equal(await adapter.get("savedItems", "saved-new"), undefined, "failed staging does not write incoming");
    });
  });

  harness.test(`${options.name}: import rejects invalid snapshots`, async () => {
    await withAdapter(async (adapter) => {
      await adapter.open();
      await expectStorageError(harness, () => adapter.importSnapshot({ ...makeSnapshot({}), formatVersion: 999 }, { mode: "preview" }), "STORAGE_SNAPSHOT_INVALID", "invalid formatVersion");
      await expectStorageError(
        harness,
        () => adapter.importSnapshot({ ...makeSnapshot({ savedItems: [makeSavedItem("saved-001")] }), counts: { savedItems: 2 } }, { mode: "preview" }),
        "STORAGE_SNAPSHOT_INVALID",
        "count mismatch"
      );
      await expectStorageError(
        harness,
        () => adapter.importSnapshot({ ...makeSnapshot({}), records: { extensionScanCheckpoint: [] } as never }, { mode: "preview" }),
        "STORAGE_VALIDATION_FAILED",
        "illegal store"
      );
      await expectStorageError(
        harness,
        () => adapter.importSnapshot(makeSnapshot({ savedItems: [{ ...makeSavedItem("saved-001"), id: "" }] }), { mode: "preview" }),
        "STORAGE_VALIDATION_FAILED",
        "missing snapshot primary key"
      );
      await expectStorageError(
        harness,
        () => adapter.importSnapshot({ ...makeSnapshot({}), records: { savedItems: [{ __proto__: { polluted: true }, id: "bad" }] } as never }, { mode: "preview" }),
        "STORAGE_VALIDATION_FAILED",
        "prototype pollution snapshot"
      );
    });
  });

  harness.test(`${options.name}: errors are structured and safe`, async () => {
    await withAdapter(async (adapter) => {
      const closedError = await expectStorageError(harness, () => adapter.put("savedItems", makeSavedItem("saved-001")), "STORAGE_UNAVAILABLE", "closed put");
      harness.assert(closedError instanceof StorageError, "closed put should be StorageError");
      const errorJson = (closedError as StorageError).toJSON();
      harness.equal(errorJson.adapter, adapter.kind, "safe error adapter");
      harness.equal(errorJson.recoverable, true, "safe error recoverable");
      harness.assert(!JSON.stringify(errorJson).includes("xsec_token"), "safe error should not include token-like data");
    });
  });

  harness.test(`${options.name}: all stores have fixture records and primary key config`, async () => {
    const records = makeAllStoreRecords();
    for (const store of STORAGE_ENTITY_NAMES) {
      const keyField = STORE_PRIMARY_KEYS[store];
      harness.assert(Boolean(keyField), `${store} primary key configured`);
      harness.assert(records[store] !== undefined, `${store} fixture exists`);
      harness.assert((records[store] as unknown as Record<string, unknown>)[keyField] !== undefined, `${store} fixture has primary key`);
    }
  });
}

async function seedQueryItems(adapter: StorageAdapter): Promise<void> {
  await adapter.open();
  await adapter.bulkPut("savedItems", [
    makeSavedItem("saved-001", {
      contentDomain: "AI 与效率" as never,
      ...(withRuntimeField("sourceItemId", "source-001") as Partial<ReturnType<typeof makeSavedItem>>),
      updatedAt: "2026-07-15T01:00:00.000Z"
    }),
    makeSavedItem("saved-002", {
      contentDomain: "出行与探店" as never,
      updatedAt: "2026-07-15T02:00:00.000Z"
    }),
    makeSavedItem("saved-003", {
      contentDomain: "AI 与效率" as never,
      updatedAt: "2026-07-15T03:00:00.000Z"
    })
  ]);
}

function getPrimaryKeyForFixture<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): string | number {
  const keyField = STORE_PRIMARY_KEYS[store];
  return (value as unknown as Record<string, string | number>)[keyField];
}

function withRuntimeField(key: string, value: unknown): Record<string, unknown> {
  return { [key]: value };
}

function makeSnapshot(records: Partial<{ [K in StorageEntityName]: StorageRecordMap[K][] }>): StorageSnapshot {
  const counts: StorageSnapshot["counts"] = {};
  for (const [store, storeRecords] of Object.entries(records)) {
    counts[store as StorageEntityName] = storeRecords.length;
  }
  return {
    formatVersion: 1,
    sourceStorage: "memory",
    sourceSchemaVersion: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    counts,
    records
  };
}

export function getContractCaseCount(): number {
  return 36;
}
