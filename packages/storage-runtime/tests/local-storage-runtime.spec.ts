import { APP_SCHEMA_VERSION, type AppState } from "@revival/shared-types";
import { createInitialDemoData, STORAGE_KEY } from "@revival/database";
import {
  DEFAULT_RUNTIME_THEME_ID,
  LocalStorageRuntime,
  RUNTIME_ACHIEVEMENTS_STORAGE_KEY,
  RUNTIME_THEME_STORAGE_KEY,
  StorageRuntimeError
} from "../src";
import { TestHarness } from "./test-harness";

class FakeStorage {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: Array<{ key: string; value: string }> = [];
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    this.reads.push(key);
    if (this.failReads) throw new Error("secret userNote https://example.test/?token=private");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("secret body https://example.test/?token=private");
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

export function registerLocalStorageRuntimeTests(harness: TestHarness): void {
  harness.test("contract exposes local runtime kind, capabilities, and lifecycle", () => {
    const runtime = new LocalStorageRuntime({ storage: new FakeStorage() });
    harness.equal(runtime.kind, "localStorage", "kind");
    harness.equal(runtime.lifecycle, "closed", "initial lifecycle");
    harness.equal(runtime.capabilities.asynchronousLoad, true, "async load capability");
    harness.equal(runtime.capabilities.transactionalWrites, false, "transaction capability");
    harness.equal(runtime.capabilities.entityDiffWrites, false, "diff capability");
    harness.equal(runtime.capabilities.indexedQueries, false, "index capability");
    harness.equal(runtime.capabilities.persistent, true, "persistence capability");
  });

  harness.test("construction and open are inert, and open is idempotent", async () => {
    const storage = new FakeStorage();
    const runtime = new LocalStorageRuntime({ storage });
    harness.equal(storage.reads.length, 0, "constructor reads");
    await runtime.open();
    await runtime.open();
    harness.equal(storage.reads.length, 0, "open reads");
    harness.equal(runtime.lifecycle, "open", "open lifecycle");
  });

  harness.test("load and persist require an open runtime", async () => {
    const runtime = new LocalStorageRuntime({ storage: new FakeStorage() });
    const state = createInitialDemoData();
    await harness.rejects(() => runtime.loadAppState(), "RUNTIME_NOT_OPEN", "load before open");
    await harness.rejects(() => runtime.persistAppState(state, state), "RUNTIME_NOT_OPEN", "persist before open");
  });

  harness.test("missing state returns the current demo in memory without writing", async () => {
    const storage = new FakeStorage();
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.assert(result.state.savedItems.length > 0, "demo should be available in memory");
    harness.equal(result.warnings[0]?.code, "RUNTIME_DATA_MISSING", "missing warning");
    harness.equal(storage.writes.length, 0, "missing state writes");
    harness.equal(runtime.lifecycle, "ready", "missing data remains usable");
  });

  harness.test("valid state is normalized through the database helper", async () => {
    const storage = new FakeStorage();
    const legacy = createInitialDemoData();
    legacy.schemaVersion = 2;
    legacy.planCards = undefined;
    storage.values.set(STORAGE_KEY, JSON.stringify(legacy));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.equal(result.state.schemaVersion, APP_SCHEMA_VERSION, "normalized schema");
    harness.assert(Array.isArray(result.state.planCards), "normalized optional collection");
    harness.equal(storage.writes.length, 0, "load writes");
  });

  harness.test("load includes theme and achievements without reading internal keys", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    storage.values.set(RUNTIME_THEME_STORAGE_KEY, "lavender-mint");
    storage.values.set(RUNTIME_ACHIEVEMENTS_STORAGE_KEY, JSON.stringify({ first_revival: "2026-07-18T00:00:00.000Z" }));
    storage.values.set("developerMode", "true");
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.equal(result.settings.themeId, "lavender-mint", "theme");
    harness.equal(result.settings.achievements.first_revival, "2026-07-18T00:00:00.000Z", "achievement");
    harness.assert(!storage.reads.includes("developerMode"), "developerMode excluded");
    harness.assert(!storage.reads.includes("collection-revival-real-user-tests:v1"), "real-test excluded");
    harness.assert(!storage.reads.includes("collection-revival-system:qa-write-test"), "QA excluded");
  });

  harness.test("invalid achievement settings degrade only that setting", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    storage.values.set(RUNTIME_ACHIEVEMENTS_STORAGE_KEY, "{broken");
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.equal(result.settings.achievements.first_revival, undefined, "achievement fallback");
    harness.equal(result.warnings[0]?.code, "RUNTIME_SETTING_INVALID", "setting warning");
    harness.equal(runtime.lifecycle, "ready", "main state remains ready");
  });

  harness.test("corrupt JSON is never overwritten and blocks persistence", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, "{broken-json");
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.equal(result.warnings[0]?.code, "RUNTIME_JSON_INVALID", "JSON warning");
    harness.equal(runtime.lifecycle, "degraded", "degraded lifecycle");
    harness.equal(storage.values.get(STORAGE_KEY), "{broken-json", "raw value");
    await harness.rejects(
      () => runtime.persistAppState(result.state, { ...result.state, searchLogs: [] }),
      "RUNTIME_DATA_INVALID",
      "persist corrupt fallback"
    );
    harness.equal(storage.values.get(STORAGE_KEY), "{broken-json", "raw value after blocked persist");
  });

  harness.test("unsupported schema is never overwritten", async () => {
    const storage = new FakeStorage();
    const raw = JSON.stringify({ ...createInitialDemoData(), schemaVersion: APP_SCHEMA_VERSION + 1 });
    storage.values.set(STORAGE_KEY, raw);
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.equal(result.warnings[0]?.code, "RUNTIME_SCHEMA_UNSUPPORTED", "schema warning");
    harness.equal(storage.values.get(STORAGE_KEY), raw, "unsupported raw value");
    harness.equal(storage.writes.length, 0, "unsupported writes");
  });

  harness.test("health check is read-only and recognizes missing state", async () => {
    const storage = new FakeStorage();
    const runtime = new LocalStorageRuntime({ storage, now: () => new Date("2026-07-18T00:00:00.000Z") });
    await runtime.open();
    const report = await runtime.healthCheck();
    harness.equal(report.ok, true, "missing state health");
    harness.equal(report.checkedAt, "2026-07-18T00:00:00.000Z", "health timestamp");
    harness.equal(storage.writes.length, 0, "health writes");
  });

  harness.test("health check reports corrupt state without replacing it", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, "{broken-json");
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const report = await runtime.healthCheck();
    harness.equal(report.ok, false, "corrupt health");
    harness.equal(report.issues[0]?.code, "RUNTIME_JSON_INVALID", "health issue");
    harness.equal(storage.values.get(STORAGE_KEY), "{broken-json", "health raw value");
  });

  harness.test("health check handles unavailable storage safely", async () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const report = await runtime.healthCheck();
    harness.equal(report.ok, false, "unavailable health");
    harness.equal(report.issues[0]?.code, "RUNTIME_UNAVAILABLE", "unavailable issue");
  });

  harness.test("persist writes the existing main key format and skips identical state", async () => {
    const storage = new FakeStorage();
    const state = createInitialDemoData();
    storage.values.set(STORAGE_KEY, JSON.stringify(state));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const loaded = await runtime.loadAppState();
    const unchanged = await runtime.persistAppState(loaded.state, loaded.state);
    harness.equal(unchanged.changed, false, "unchanged result");
    harness.equal(storage.writes.length, 0, "unchanged writes");
    const next = {
      ...loaded.state,
      searchLogs: [{ id: "changed", userId: "user", query: "changed", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }]
    };
    const changed = await runtime.persistAppState(loaded.state, next);
    harness.equal(changed.changed, true, "changed result");
    harness.equal(storage.writes[0]?.key, STORAGE_KEY, "main key");
    harness.equal(storage.writes[0]?.value, JSON.stringify(next), "legacy serialization");
  });

  harness.test("product settings retain their existing keys", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const loaded = await runtime.loadAppState();
    const nextSettings = {
      themeId: "mist-blue",
      achievements: { first_revival: "2026-07-18T00:00:00.000Z" }
    };
    await runtime.persistProductSettings(loaded.settings, nextSettings);
    harness.equal(storage.values.get(RUNTIME_THEME_STORAGE_KEY), "mist-blue", "theme key");
    harness.equal(
      storage.values.get(RUNTIME_ACHIEVEMENTS_STORAGE_KEY),
      JSON.stringify(nextSettings.achievements),
      "achievement key"
    );
    harness.equal(storage.values.size, 3, "no new runtime metadata key");
  });

  harness.test("persist failures surface a safe runtime error", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const loaded = await runtime.loadAppState();
    storage.failWrites = true;
    let caught: unknown;
    try {
      await runtime.persistAppState(loaded.state, {
        ...loaded.state,
        searchLogs: [{ id: "failure", userId: "user", query: "failure", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }]
      });
    } catch (error) {
      caught = error;
    }
    harness.assert(caught instanceof StorageRuntimeError, "runtime error type");
    harness.equal(caught.code, "RUNTIME_PERSIST_FAILED", "persist error code");
    const serialized = JSON.stringify(caught.toSafeJSON());
    harness.assert(!serialized.includes("userNote"), "safe error excludes note");
    harness.assert(!serialized.includes("token="), "safe error excludes URL token");
    harness.assert(!serialized.includes("secret body"), "safe error excludes cause");
  });

  harness.test("concurrent loads share one read", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const [first, second] = await Promise.all([runtime.loadAppState(), runtime.loadAppState()]);
    harness.equal(first.state.savedItems.length, second.state.savedItems.length, "load results");
    harness.equal(storage.reads.filter((key) => key === STORAGE_KEY).length, 1, "main state read count");
  });

  harness.test("concurrent persists are serialized and the newest state wins", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const loaded = await runtime.loadAppState();
    const second: AppState = { ...loaded.state, searchLogs: [{ id: "one", userId: "user", query: "one", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }] };
    const third: AppState = { ...second, searchLogs: [...second.searchLogs, { id: "two", userId: "user", query: "two", resultCount: 2, createdAt: "2026-07-18T00:01:00.000Z" }] };
    await Promise.all([
      runtime.persistAppState(loaded.state, second),
      runtime.persistAppState(second, third)
    ]);
    harness.equal(storage.values.get(STORAGE_KEY), JSON.stringify(third), "latest state");
    harness.equal(storage.writes.length, 2, "serialized writes");
  });

  harness.test("returned load values do not share mutable references", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const first = await runtime.loadAppState();
    first.state.savedItems.length = 0;
    const second = await runtime.loadAppState();
    harness.assert(second.state.savedItems.length > 0, "cached result clone");
  });

  harness.test("close is idempotent and blocks data operations", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    await runtime.loadAppState();
    await runtime.close();
    await runtime.close();
    harness.equal(runtime.lifecycle, "closed", "closed lifecycle");
    await harness.rejects(() => runtime.loadAppState(), "RUNTIME_NOT_OPEN", "load after close");
  });

  harness.test("a closed runtime can reopen and reload persisted data", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    await runtime.loadAppState();
    await runtime.close();
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.assert(result.state.savedItems.length > 0, "reopened data");
  });

  harness.test("default product settings are stable", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_KEY, JSON.stringify(createInitialDemoData()));
    const runtime = new LocalStorageRuntime({ storage });
    await runtime.open();
    const result = await runtime.loadAppState();
    harness.equal(result.settings.themeId, DEFAULT_RUNTIME_THEME_ID, "default theme");
    harness.equal(Object.keys(result.settings.achievements).length, 0, "default achievements");
  });

  harness.test("runtime source does not access IndexedDB, chrome storage, or bootstrap markers", () => {
    const source = `${LocalStorageRuntime}`;
    harness.assert(!source.includes("indexedDB"), "no IndexedDB access");
    harness.assert(!source.includes("chrome.storage"), "no extension storage access");
    harness.assert(!source.includes("activeStorage"), "no active storage marker");
  });
}
