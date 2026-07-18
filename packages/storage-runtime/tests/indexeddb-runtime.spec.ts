import { IDBKeyRange as FakeIDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { APP_SCHEMA_VERSION, type AppState } from "@revival/shared-types";
import { createInitialDemoData } from "@revival/database";
import {
  IndexedDbAdapter,
  RUNTIME_APP_METADATA_KEY,
  RUNTIME_ORDER_MANIFEST_KEY,
  deleteIndexedDbDatabase,
  type StorageEntityName,
  type StorageTransaction,
  type StorageTransactionMode
} from "@revival/storage-service";
import {
  IndexedDbRuntime,
  compareRuntimeStateBundles,
  createRuntimeStateDiff,
  dehydrateRuntimeState,
  hydrateRuntimeState,
  type RuntimeStateBundle
} from "../src";
import { TestHarness } from "./test-harness";

let databaseCounter = 0;

export function registerIndexedDbRuntimeTests(harness: TestHarness): void {
  harness.test("runtime metadata and order manifest round-trip all AppState collections", () => {
    const bundle = makeBundle();
    bundle.state.savedItems.reverse();
    const dehydrated = dehydrateRuntimeState(bundle, "2026-07-18T00:00:00.000Z");
    const keys = dehydrated.settings.map((setting) => setting.key);
    harness.assert(keys.includes(RUNTIME_APP_METADATA_KEY), "metadata key");
    harness.assert(keys.includes(RUNTIME_ORDER_MANIFEST_KEY), "manifest key");
    const hydrated = hydrateRuntimeState(dehydrated);
    harness.equal(hydrated.state.schemaVersion, APP_SCHEMA_VERSION, "app schema");
    harness.equal(hydrated.state.user.id, bundle.state.user.id, "user round-trip");
    harness.equal(hydrated.state.savedItems[0]?.id, bundle.state.savedItems[0]?.id, "saved item order");
    harness.equal(hydrated.state.planCards?.length, 0, "empty optional collection retained");
    harness.equal(hydrated.settings.themeId, bundle.settings.themeId, "theme round-trip");
  });

  harness.test("hydrator rejects missing metadata and inconsistent manifest", async () => {
    const dehydrated = dehydrateRuntimeState(makeBundle(), "2026-07-18T00:00:00.000Z");
    const withoutMetadata = clone(dehydrated);
    withoutMetadata.settings = withoutMetadata.settings.filter((setting) => setting.key !== RUNTIME_APP_METADATA_KEY);
    await harness.rejects(async () => hydrateRuntimeState(withoutMetadata), "RUNTIME_METADATA_MISSING", "missing metadata");

    const badManifest = clone(dehydrated);
    const setting = badManifest.settings.find((entry) => entry.key === RUNTIME_ORDER_MANIFEST_KEY)!;
    (setting.value as { orders: { savedItems: string[] } }).orders.savedItems.push("missing-id");
    await harness.rejects(async () => hydrateRuntimeState(badManifest), "RUNTIME_ORDER_MANIFEST_INVALID", "manifest mismatch");
  });

  harness.test("diff is empty for equivalent state and isolates order, user and settings changes", () => {
    const before = makeBundle();
    const same = createRuntimeStateDiff(before, clone(before), "2026-07-18T00:00:00.000Z");
    harness.equal(same.isEmpty, true, "identical diff");

    const reordered = clone(before);
    reordered.state.savedItems.reverse();
    const orderDiff = createRuntimeStateDiff(before, reordered, "2026-07-18T00:00:00.000Z");
    harness.equal(orderDiff.orderManifestChanged, true, "order manifest changed");
    harness.equal(orderDiff.changedStoreNames.length, 0, "order does not rewrite entities");

    const userChanged = clone(before);
    userChanged.state.user.name = "New local name";
    const userDiff = createRuntimeStateDiff(before, userChanged, "2026-07-18T00:00:00.000Z");
    harness.equal(userDiff.metadataChanged, true, "user updates metadata");
    harness.equal(userDiff.changedStoreNames.length, 0, "user does not rewrite entities");

    const settingsChanged = clone(before);
    settingsChanged.settings.themeId = "night";
    const settingsDiff = createRuntimeStateDiff(before, settingsChanged, "2026-07-18T00:00:00.000Z");
    harness.equal(settingsDiff.productSettingsChanged.theme, true, "theme setting changed");
    harness.equal(settingsDiff.changedSettings.length, 1, "only theme record changed");
  });

  harness.test("IndexedDbRuntime constructor is inert and capabilities match implementation", () => {
    const adapter = createAdapter();
    const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
    harness.equal(runtime.lifecycle, "closed", "initial lifecycle");
    harness.equal(runtime.kind, "indexedDB", "runtime kind");
    harness.equal(runtime.capabilities.transactionalWrites, true, "transactions");
    harness.equal(runtime.capabilities.entityDiffWrites, true, "entity diff");
    harness.equal(runtime.capabilities.persistent, true, "persistent");
  });

  harness.test("IndexedDbRuntime loads a complete ordered round-trip and healthCheck is read-only", async () => {
    const name = nextName("roundtrip");
    const adapter = createAdapter(name);
    const expected = makeBundle();
    try {
      await seedAdapter(adapter, expected);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      const health = await runtime.healthCheck();
      harness.equal(health.ok, true, "health check");
      const loaded = await runtime.loadAppState();
      const result = compareRuntimeStateBundles(expected, { state: loaded.state, settings: loaded.settings });
      harness.equal(result.equivalent, true, "round-trip equivalent");
      harness.equal(runtime.lifecycle, "ready", "ready after load");
      await runtime.close();
      harness.equal(runtime.lifecycle, "closed", "closed");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbRuntime blocks missing runtime metadata without guessing or fallback", async () => {
    const name = nextName("missing-metadata");
    const adapter = createAdapter(name);
    try {
      await adapter.open();
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      await harness.rejects(() => runtime.loadAppState(), "RUNTIME_METADATA_MISSING", "missing metadata");
      harness.equal(runtime.lifecycle, "degraded", "missing metadata degrades runtime");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("IndexedDbRuntime persists entity create update delete and order-only diffs", async () => {
    const name = nextName("diff-persist");
    const adapter = createAdapter(name);
    const initial = makeBundle();
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1, now: () => new Date("2026-07-18T01:00:00.000Z") });
      await runtime.open();
      await runtime.loadAppState();
      const next = clone(initial.state);
      const removedId = next.savedItems[1].id;
      next.savedItems[0] = { ...next.savedItems[0], userNote: "Edited note" };
      next.savedItems = [
        { ...clone(next.savedItems[0]), id: "saved-created", sourceUrl: "https://example.test/created" },
        ...next.savedItems.filter((item) => item.id !== removedId)
      ].reverse();
      const result = await runtime.persistAppState(initial.state, next);
      harness.equal(result.changed, true, "persist reports change");
      await runtime.close();

      const verifier = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await verifier.open();
      const loaded = await verifier.loadAppState();
      harness.equal(loaded.state.savedItems[0]?.id, next.savedItems[0]?.id, "order persisted");
      harness.equal(loaded.state.savedItems.find((item) => item.id === next.savedItems[0]?.id)?.userNote, next.savedItems[0]?.userNote, "nested update persisted");
      harness.assert(loaded.state.savedItems.some((item) => item.id === "saved-created"), "created entity persisted");
      harness.equal(loaded.state.savedItems.some((item) => item.id === removedId), false, "deleted entity absent");
      await verifier.close();
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("broken references and stale baselines produce zero writes", async () => {
    const name = nextName("validation");
    const adapter = createAdapter(name);
    const initial = makeBundle();
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      await runtime.loadAppState();
      const broken = clone(initial.state);
      broken.actionCards.push({
        id: "bad-action", savedItemId: "missing", category: "技能学习", subCategory: "测试", title: "Broken",
        goal: "Test", whySaved: "Test", nextAction: "Test", openOriginalFocus: [], output: "Test",
        estimatedTime: "5 minutes", difficulty: "低", doneCriteria: "Done", avoidDoing: "None",
        ifInfoMissing: "Stop", followUp: "None", fields: {}, tasks: [],
        createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z"
      });
      await harness.rejects(() => runtime.persistAppState(initial.state, broken), "RUNTIME_ENTITY_REFERENCE_BROKEN", "broken reference");
      harness.equal((await adapter.getAll("actionCards")).length, initial.state.actionCards.length, "no partial action write");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("a failed multi-store transaction rolls back every changed store", async () => {
    const name = nextName("atomic");
    const adapter = new FailingIndexedDbAdapter(name);
    const initial = makeBundle();
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      await runtime.loadAppState();
      adapter.failNextWrite = true;
      const next = clone(initial.state);
      next.savedItems[0] = { ...next.savedItems[0], userNote: "must rollback" };
      next.searchLogs.push({ id: "search-new", userId: next.user.id, query: "test", resultCount: 0, createdAt: "2026-07-18T00:00:00.000Z" });
      await harness.rejects(() => runtime.persistAppState(initial.state, next), "RUNTIME_TRANSACTION_FAILED", "atomic failure");
      harness.equal((await adapter.get("savedItems", initial.state.savedItems[0].id))?.userNote, initial.state.savedItems[0].userNote, "saved item rolled back");
      harness.equal(await adapter.get("searchLogs", "search-new"), undefined, "search log rolled back");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("change-set read-back failure is reported without localStorage fallback", async () => {
    const name = nextName("verification");
    const adapter = new VerificationFailingIndexedDbAdapter(name);
    const initial = makeBundle();
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      await runtime.loadAppState();
      const next = clone(initial.state);
      next.savedItems[0] = { ...next.savedItems[0], userNote: "committed but verification injected" };
      adapter.failNextVerification = true;
      await harness.rejects(() => runtime.persistAppState(initial.state, next), "RUNTIME_VERIFICATION_FAILED", "read-back failure");
      harness.equal(runtime.lifecycle, "degraded", "verification failure degrades runtime");
      harness.equal((await adapter.get("savedItems", next.savedItems[0].id))?.userNote, next.savedItems[0].userNote, "transaction was committed before verification");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("queued persists use the last successful baseline in order", async () => {
    const name = nextName("queue");
    const adapter = createAdapter(name);
    const initial = makeBundle();
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      await runtime.loadAppState();
      const first = clone(initial.state);
      first.savedItems[0] = { ...first.savedItems[0], userNote: "first" };
      const second = clone(first);
      second.savedItems[0] = { ...second.savedItems[0], userNote: "second" };
      await Promise.all([
        runtime.persistAppState(initial.state, first),
        runtime.persistAppState(first, second)
      ]);
      harness.equal((await adapter.get("savedItems", second.savedItems[0].id))?.userNote, "second", "latest queued state persisted");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });
  harness.test("product settings update does not overwrite runtime metadata", async () => {
    const name = nextName("settings");
    const adapter = createAdapter(name);
    const initial = makeBundle();
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      await runtime.loadAppState();
      const metadataBefore = await adapter.get("settings", RUNTIME_APP_METADATA_KEY);
      await runtime.persistProductSettings(initial.settings, { themeId: "night", achievements: { first: "done" } });
      const metadataAfter = await adapter.get("settings", RUNTIME_APP_METADATA_KEY);
      harness.equal(JSON.stringify(metadataAfter), JSON.stringify(metadataBefore), "metadata untouched");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("3,000 record IndexedDB round-trip and small diff preserve equivalence", async () => {
    const name = nextName("large-3000");
    const adapter = createAdapter(name);
    const initial = makeLargeBundle(3000);
    try {
      await seedAdapter(adapter, initial);
      const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
      await runtime.open();
      const loaded = await runtime.loadAppState();
      harness.equal(loaded.state.savedItems.length, 3000, "large hydrate count");
      const next = clone(loaded.state);
      next.savedItems[1500] = { ...next.savedItems[1500], userNote: "single diff" };
      await runtime.persistAppState(loaded.state, next);
      harness.equal((await adapter.get("savedItems", next.savedItems[1500].id))?.userNote, "single diff", "small diff persisted");
    } finally {
      await adapter.close();
      await deleteIndexedDbDatabase(name, fakeIndexedDB);
    }
  });

  harness.test("10,000 record codec round-trip is iterative and order exact", () => {
    const bundle = makeLargeBundle(10000);
    const dehydrated = dehydrateRuntimeState(bundle, "2026-07-18T00:00:00.000Z");
    const hydrated = hydrateRuntimeState(dehydrated);
    harness.equal(hydrated.state.savedItems.length, 10000, "ten thousand count");
    harness.equal(hydrated.state.savedItems[9999]?.id, bundle.state.savedItems[9999]?.id, "last order exact");
    harness.equal(compareRuntimeStateBundles(bundle, { state: hydrated.state, settings: hydrated.settings }).equivalent, true, "large equivalent");
  });
}

class VerificationFailingIndexedDbAdapter extends IndexedDbAdapter {
  failNextVerification = false;
  private corruptNextRead = false;

  constructor(databaseName: string) {
    super({ databaseName, schemaVersion: 1, indexedDBFactory: fakeIndexedDB, keyRangeFactory: FakeIDBKeyRange });
  }

  override async transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    if (mode === "readonly" && this.corruptNextRead) {
      this.corruptNextRead = false;
      return super.transaction(stores, mode, (tx) => operation(new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "get") return async () => undefined;
          return Reflect.get(target, property, receiver);
        }
      })));
    }
    const result = await super.transaction(stores, mode, operation);
    if (mode === "readwrite" && this.failNextVerification) {
      this.failNextVerification = false;
      this.corruptNextRead = true;
    }
    return result;
  }
}
class FailingIndexedDbAdapter extends IndexedDbAdapter {
  failNextWrite = false;

  constructor(databaseName: string) {
    super({ databaseName, schemaVersion: 1, indexedDBFactory: fakeIndexedDB, keyRangeFactory: FakeIDBKeyRange });
  }

  override async transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    if (mode === "readwrite" && this.failNextWrite) {
      this.failNextWrite = false;
      return super.transaction(stores, mode, async (tx) => {
        const result = await operation(tx);
        throw new Error("injected transaction failure");
      });
    }
    return super.transaction(stores, mode, operation);
  }
}

function makeBundle(): RuntimeStateBundle {
  const state = createInitialDemoData();
  return { state, settings: { themeId: "sprout", achievements: { welcome: "done" } } };
}

function makeLargeBundle(count: number): RuntimeStateBundle {
  const demo = createInitialDemoData();
  const seed = demo.savedItems[0];
  const savedItems = Array.from({ length: count }, (_, index) => ({
    ...clone(seed),
    id: `saved-${String(index).padStart(6, "0")}`,
    sourceUrl: `https://example.test/items/${index}`,
    userNote: index % 500 === 0 ? `Unicode note ${index}` : ""
  }));
  const state: AppState = {
    schemaVersion: APP_SCHEMA_VERSION,
    user: clone(demo.user),
    savedItems,
    actionCards: [],
    planCards: [],
    classificationCorrections: [],
    searchLogs: [],
    smartAlbums: [],
    importBatches: [],
    importBatchItems: []
  };
  return { state, settings: { themeId: "sprout", achievements: {} } };
}

async function seedAdapter(adapter: IndexedDbAdapter, bundle: RuntimeStateBundle): Promise<void> {
  await adapter.open();
  const dehydrated = dehydrateRuntimeState(bundle, "2026-07-18T00:00:00.000Z");
  await adapter.transaction([
    "savedItems", "actionCards", "planCards", "classificationCorrections", "searchLogs",
    "smartAlbums", "importBatches", "importBatchItems", "settings"
  ], "readwrite", async (tx) => {
    for (const record of dehydrated.stores.savedItems) await tx.put("savedItems", record);
    for (const record of dehydrated.stores.actionCards) await tx.put("actionCards", record);
    for (const record of dehydrated.stores.planCards) await tx.put("planCards", record);
    for (const record of dehydrated.stores.classificationCorrections) await tx.put("classificationCorrections", record);
    for (const record of dehydrated.stores.searchLogs) await tx.put("searchLogs", record);
    for (const record of dehydrated.stores.smartAlbums) await tx.put("smartAlbums", record);
    for (const record of dehydrated.stores.importBatches) await tx.put("importBatches", record);
    for (const record of dehydrated.stores.importBatchItems) await tx.put("importBatchItems", record);
    for (const setting of dehydrated.settings) await tx.put("settings", setting);
  });
  await adapter.close();
}

function createAdapter(databaseName = nextName("adapter")): IndexedDbAdapter {
  return new IndexedDbAdapter({ databaseName, schemaVersion: 1, indexedDBFactory: fakeIndexedDB, keyRangeFactory: FakeIDBKeyRange });
}

function nextName(label: string): string {
  databaseCounter += 1;
  return `task8b-${label}-${databaseCounter}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
