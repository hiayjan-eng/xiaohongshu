import type { AppState } from "@revival/shared-types";
import {
  RUNTIME_APP_METADATA_KEY,
  RUNTIME_ORDERED_COLLECTIONS,
  RUNTIME_ORDER_MANIFEST_KEY,
  STORAGE_ENTITY_NAMES,
  type StorageAdapter,
  type StorageEntityName,
  type StorageRecordMap,
  type StorageTransaction,
  type StoredSetting
} from "@revival/storage-service";
import type {
  ActiveStorageRuntime,
  StorageRuntimeCapabilities,
  StorageRuntimeHealthIssue,
  StorageRuntimeHealthReport,
  StorageRuntimeLifecycle,
  StorageRuntimeLoadResult,
  StorageRuntimePersistResult,
  StorageRuntimeProductSettings
} from "./contracts";
import {
  canonicalRuntimeValue,
  dehydrateRuntimeState,
  hydrateRuntimeState,
  type DehydratedRuntimeState,
  type RuntimeEntityStoreName,
  type RuntimeStateBundle
} from "./app-state-codec";
import { createRuntimeStateDiff, type RuntimeStateDiff, type RuntimeStoreDiff } from "./app-state-diff";
import { StorageRuntimeError, type StorageRuntimeErrorCode } from "./errors";

export interface IndexedDbRuntimeOptions {
  adapter: StorageAdapter;
  expectedSchemaVersion: number;
  now?: () => Date;
}

export class IndexedDbRuntime implements ActiveStorageRuntime {
  readonly kind = "indexedDB" as const;
  readonly capabilities: StorageRuntimeCapabilities = Object.freeze({
    asynchronousLoad: true,
    transactionalWrites: true,
    entityDiffWrites: true,
    indexedQueries: true,
    persistent: true
  });

  private state: StorageRuntimeLifecycle = "closed";
  private readonly adapter: StorageAdapter;
  private readonly expectedSchemaVersion: number;
  private readonly now: () => Date;
  private loadPromise?: Promise<StorageRuntimeLoadResult>;
  private persistTail: Promise<unknown> = Promise.resolve();
  private current?: RuntimeStateBundle;

  constructor(options: IndexedDbRuntimeOptions) {
    if (options.adapter.kind !== "indexedDB") {
      throw new StorageRuntimeError({
        code: "RUNTIME_ADAPTER_KIND_INVALID",
        runtimeKind: "indexedDB",
        lifecycle: "closed",
        recoverable: false
      });
    }
    this.adapter = options.adapter;
    this.expectedSchemaVersion = options.expectedSchemaVersion;
    this.now = options.now ?? (() => new Date());
  }

  get lifecycle(): StorageRuntimeLifecycle {
    return this.state;
  }

  async open(): Promise<void> {
    if (this.state !== "closed") return;
    this.state = "opening";
    try {
      if (!await this.adapter.isAvailable()) throw this.error("RUNTIME_UNAVAILABLE", true);
      await this.adapter.open();
      const schemaVersion = await this.adapter.getSchemaVersion();
      if (schemaVersion !== this.expectedSchemaVersion) {
        await this.adapter.close();
        throw this.error("RUNTIME_TARGET_SCHEMA_MISMATCH", false);
      }
      this.state = "open";
    } catch (cause) {
      this.state = "failed";
      if (cause instanceof StorageRuntimeError) throw cause;
      throw this.error("RUNTIME_UNAVAILABLE", true, cause);
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    await this.persistTail.catch(() => undefined);
    await this.adapter.close();
    this.state = "closed";
    this.loadPromise = undefined;
    this.current = undefined;
  }

  async healthCheck(): Promise<StorageRuntimeHealthReport> {
    this.ensureOpen();
    const issues: StorageRuntimeHealthIssue[] = [];
    let schemaVersion: number | undefined;
    try {
      const adapterHealth = await this.adapter.healthCheck();
      schemaVersion = await this.adapter.getSchemaVersion();
      if (!adapterHealth.available) issues.push({ code: "RUNTIME_UNAVAILABLE", blocking: true });
      if (schemaVersion !== this.expectedSchemaVersion) {
        issues.push({ code: "RUNTIME_TARGET_SCHEMA_MISMATCH", blocking: true });
      }
      const dehydrated = await this.adapter.transaction([...STORAGE_ENTITY_NAMES], "readonly", async (tx) => {
        const runtimeData = await readRuntimeData(tx);
        await tx.getAll("migrationMetadata");
        await tx.getAll("backups");
        return runtimeData;
      });
      hydrateRuntimeState(dehydrated);
    } catch (cause) {
      issues.push({ code: issueCode(cause), blocking: true });
    }
    return {
      ok: issues.length === 0,
      kind: this.kind,
      schemaVersion,
      issues,
      checkedAt: this.now().toISOString()
    };
  }

  async loadAppState(): Promise<StorageRuntimeLoadResult> {
    this.ensureOpen();
    if (this.current) return makeLoadResult(this.current, [], this.now, this.expectedSchemaVersion);
    if (this.loadPromise) return clone(await this.loadPromise);
    this.loadPromise = this.performLoad();
    try {
      return clone(await this.loadPromise);
    } finally {
      this.loadPromise = undefined;
    }
  }

  async persistAppState(previous: AppState, next: AppState): Promise<StorageRuntimePersistResult> {
    return this.enqueuePersist(async () => {
      const baseline = this.requireBaseline();
      if (canonicalRuntimeValue(previous) !== canonicalRuntimeValue(baseline.state)) {
        throw this.error("RUNTIME_BASELINE_MISMATCH", false);
      }
      const timestamp = this.now().toISOString();
      const nextBundle: RuntimeStateBundle = { state: clone(next), settings: clone(baseline.settings) };
      const diff = createRuntimeStateDiff(baseline, nextBundle, timestamp);
      if (diff.isEmpty) return this.persistResult(false, timestamp);
      await this.persistDiff(diff);
      await this.verifyDiff(diff);
      this.current = nextBundle;
      return this.persistResult(true, timestamp);
    });
  }

  async persistProductSettings(
    previous: StorageRuntimeProductSettings,
    next: StorageRuntimeProductSettings
  ): Promise<StorageRuntimePersistResult> {
    return this.enqueuePersist(async () => {
      const baseline = this.requireBaseline();
      if (canonicalRuntimeValue(previous) !== canonicalRuntimeValue(baseline.settings)) {
        throw this.error("RUNTIME_BASELINE_MISMATCH", false);
      }
      const timestamp = this.now().toISOString();
      const nextBundle: RuntimeStateBundle = { state: clone(baseline.state), settings: clone(next) };
      const diff = createRuntimeStateDiff(baseline, nextBundle, timestamp);
      if (diff.isEmpty) return this.persistResult(false, timestamp);
      await this.persistDiff(diff);
      await this.verifyDiff(diff);
      this.current = nextBundle;
      return this.persistResult(true, timestamp);
    });
  }

  private async performLoad(): Promise<StorageRuntimeLoadResult> {
    this.state = "loading";
    try {
      const dehydrated = await this.adapter.transaction(runtimeReadStores(), "readonly", readRuntimeData);
      const hydrated = hydrateRuntimeState(dehydrated);
      this.current = { state: clone(hydrated.state), settings: clone(hydrated.settings) };
      this.state = "ready";
      return makeLoadResult(this.current, hydrated.warnings, this.now, this.expectedSchemaVersion);
    } catch (cause) {
      this.state = "degraded";
      if (cause instanceof StorageRuntimeError) throw cause;
      throw this.error("RUNTIME_HYDRATION_FAILED", true, cause);
    }
  }

  private async persistDiff(diff: RuntimeStateDiff): Promise<void> {
    const stores: StorageEntityName[] = [...diff.changedStoreNames];
    if (diff.changedSettings.length > 0) stores.push("settings");
    try {
      await this.adapter.transaction(stores, "readwrite", async (tx) => {
        for (const store of diff.changedStoreNames) await applyStoreDiff(tx, diff.stores[store]);
        for (const setting of diff.changedSettings) await tx.put("settings", setting);
      });
    } catch (cause) {
      throw this.error("RUNTIME_TRANSACTION_FAILED", true, cause);
    }
  }

  private async verifyDiff(diff: RuntimeStateDiff): Promise<void> {
    const stores: StorageEntityName[] = [...diff.changedStoreNames];
    if (diff.changedSettings.length > 0) stores.push("settings");
    try {
      await this.adapter.transaction(stores, "readonly", async (tx) => {
        for (const store of diff.changedStoreNames) await verifyStoreDiff(tx, diff.stores[store]);
        for (const setting of diff.changedSettings) {
          const stored = await tx.get("settings", setting.key);
          if (!stored || canonicalRuntimeValue(settingRecordValue(stored)) !== canonicalRuntimeValue(settingRecordValue(setting))) {
            throw this.error("RUNTIME_VERIFICATION_FAILED", true);
          }
        }
      });
    } catch (cause) {
      if (cause instanceof StorageRuntimeError) throw cause;
      throw this.error("RUNTIME_VERIFICATION_FAILED", true, cause);
    }
  }

  private enqueuePersist<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.persistTail.then(async () => {
      this.ensureReady();
      this.state = "persisting";
      try {
        const result = await operation();
        this.state = "ready";
        return result;
      } catch (cause) {
        this.state = "degraded";
        throw cause;
      }
    });
    this.persistTail = queued.catch(() => undefined);
    return queued;
  }

  private requireBaseline(): RuntimeStateBundle {
    if (!this.current) throw this.error("RUNTIME_DATA_INVALID", false);
    return clone(this.current);
  }

  private ensureOpen(): void {
    if (this.state === "closed" || this.state === "opening" || this.state === "failed") {
      throw this.error("RUNTIME_NOT_OPEN", true);
    }
  }

  private ensureReady(): void {
    if (this.state !== "ready" || !this.current) throw this.error("RUNTIME_DATA_INVALID", false);
  }

  private persistResult(changed: boolean, persistedAt: string): StorageRuntimePersistResult {
    return { runtimeKind: this.kind, persistedAt, changed, warnings: [] };
  }

  private error(code: StorageRuntimeErrorCode, recoverable: boolean, cause?: unknown): StorageRuntimeError {
    return new StorageRuntimeError({ code, runtimeKind: this.kind, lifecycle: this.state, recoverable, cause });
  }
}

async function readRuntimeData(tx: StorageTransaction): Promise<DehydratedRuntimeState> {
  const [savedItems, actionCards, planCards, classificationCorrections, searchLogs, smartAlbums, importBatches, importBatchItems, settings] = await Promise.all([
    tx.getAll("savedItems"),
    tx.getAll("actionCards"),
    tx.getAll("planCards"),
    tx.getAll("classificationCorrections"),
    tx.getAll("searchLogs"),
    tx.getAll("smartAlbums"),
    tx.getAll("importBatches"),
    tx.getAll("importBatchItems"),
    tx.getAll("settings")
  ]);
  return { stores: { savedItems, actionCards, planCards, classificationCorrections, searchLogs, smartAlbums, importBatches, importBatchItems }, settings };
}

function runtimeReadStores(): StorageEntityName[] {
  return [...RUNTIME_ORDERED_COLLECTIONS, "settings"];
}

async function applyStoreDiff<K extends RuntimeEntityStoreName>(tx: StorageTransaction, diff: RuntimeStoreDiff<K>): Promise<void> {
  for (const record of [...diff.create, ...diff.update]) await tx.put(diff.store, record);
  for (const id of diff.deleteIds) await tx.delete(diff.store, id);
}

async function verifyStoreDiff<K extends RuntimeEntityStoreName>(tx: StorageTransaction, diff: RuntimeStoreDiff<K>): Promise<void> {
  for (const record of [...diff.create, ...diff.update]) {
    const stored = await tx.get(diff.store, record.id);
    if (!stored || canonicalRuntimeValue(stored) !== canonicalRuntimeValue(record)) {
      throw new Error("runtime change-set verification failed");
    }
  }
  for (const id of diff.deleteIds) {
    if (await tx.get(diff.store, id)) throw new Error("runtime delete verification failed");
  }
}

function settingRecordValue(setting: StoredSetting): unknown {
  return { key: setting.key, value: setting.value, category: setting.category, internal: setting.internal, schemaVersion: setting.schemaVersion };
}

function makeLoadResult(
  bundle: RuntimeStateBundle,
  warnings: StorageRuntimeLoadResult["warnings"],
  now: () => Date,
  sourceSchemaVersion: number
): StorageRuntimeLoadResult {
  return {
    state: clone(bundle.state),
    settings: clone(bundle.settings),
    runtimeKind: "indexedDB",
    loadedAt: now().toISOString(),
    sourceSchemaVersion,
    warnings: clone(warnings)
  };
}

function issueCode(cause: unknown): StorageRuntimeHealthIssue["code"] {
  if (cause instanceof StorageRuntimeError) {
    const allowed: StorageRuntimeHealthIssue["code"][] = [
      "RUNTIME_TARGET_SCHEMA_MISMATCH",
      "RUNTIME_REQUIRED_STORE_MISSING",
      "RUNTIME_METADATA_MISSING",
      "RUNTIME_METADATA_UNSUPPORTED",
      "RUNTIME_ORDER_MANIFEST_MISSING",
      "RUNTIME_ORDER_MANIFEST_INVALID",
      "RUNTIME_ENTITY_REFERENCE_BROKEN",
      "RUNTIME_HYDRATION_FAILED"
    ];
    if (allowed.includes(cause.code as StorageRuntimeHealthIssue["code"])) return cause.code as StorageRuntimeHealthIssue["code"];
  }
  return "RUNTIME_UNAVAILABLE";
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}
