import {
  MEMORY_TARGET_CAPABILITIES,
  STORAGE_ENTITY_NAMES,
  STORAGE_INDEXES,
  STORE_PRIMARY_KEYS,
  type StorageAdapter,
  type StorageBulkWriteResult,
  type StorageCapabilities,
  type StorageEntityName,
  type StorageHealthReport,
  type StorageImportOptions,
  type StorageImportResult,
  type StorageKind,
  type StoragePrimaryKey,
  type StorageQuery,
  type StorageQueryOptions,
  type StorageRecordMap,
  type StorageSnapshot,
  type StorageSnapshotOptions,
  type StorageTransaction,
  type StorageTransactionMode
} from "./contracts";
import { StorageError, type StorageErrorCode } from "./errors";
import { assertJsonSafe as assertSharedJsonSafe, cloneJsonSafe as cloneSharedJsonSafe } from "./json-utils";

type StoreData = Map<StorageEntityName, Map<StoragePrimaryKey, unknown>>;

const STORAGE_SNAPSHOT_FORMAT_VERSION = 1;
const DEFAULT_MEMORY_SCHEMA_VERSION = 1;

export interface MemoryAdapterOptions {
  schemaVersion?: number;
}

export class MemoryAdapter implements StorageAdapter {
  readonly kind: StorageKind = "memory";
  readonly capabilities: StorageCapabilities = MEMORY_TARGET_CAPABILITIES;
  private stores: StoreData = createEmptyStores();
  private opened = false;
  private transactionActive = false;
  private readonly schemaVersion: number;

  constructor(options: MemoryAdapterOptions = {}) {
    this.schemaVersion = options.schemaVersion ?? DEFAULT_MEMORY_SCHEMA_VERSION;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async get<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<StorageRecordMap[K] | undefined> {
    this.assertReady();
    return getFromStores(this.stores, store, id);
  }

  async getAll<K extends StorageEntityName>(store: K, options?: StorageQueryOptions<K>): Promise<StorageRecordMap[K][]> {
    this.assertReady();
    return getAllFromStores(this.stores, store, options);
  }

  async query<K extends StorageEntityName>(store: K, query: StorageQuery<K>): Promise<StorageRecordMap[K][]> {
    this.assertReady();
    return queryStores(this.stores, store, query);
  }

  async put<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): Promise<void> {
    this.assertReady();
    putIntoStores(this.stores, store, value);
  }

  async bulkPut<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): Promise<StorageBulkWriteResult> {
    this.assertReady();
    return bulkPutIntoStores(this.stores, store, values);
  }

  async delete<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<void> {
    this.assertReady();
    deleteFromStores(this.stores, store, id);
  }

  async clear<K extends StorageEntityName>(store: K): Promise<void> {
    this.assertReady();
    clearStore(this.stores, store);
  }

  async transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    this.assertReady({ allowActiveTransaction: false });
    if (this.transactionActive) {
      throw storageError("STORAGE_NOT_SUPPORTED", "Nested or concurrent MemoryAdapter transactions are not supported.", true);
    }

    const declaredStores = normalizeStoreList(stores);
    const workingStores = cloneSelectedStores(this.stores, declaredStores);
    const tx = createMemoryTransaction(workingStores, declaredStores, mode);
    this.transactionActive = true;

    try {
      const result = await operation(tx);
      if (mode === "readwrite") {
        for (const store of declaredStores) {
          this.stores.set(store, cloneStoreMap(workingStores.get(store) ?? new Map()));
        }
      }
      return result;
    } catch (error) {
      throw storageError("STORAGE_TRANSACTION_FAILED", "MemoryAdapter transaction failed and was rolled back.", true, undefined, error);
    } finally {
      this.transactionActive = false;
    }
  }

  async exportSnapshot(options: StorageSnapshotOptions = {}): Promise<StorageSnapshot> {
    this.assertReady();
    const includedStores = normalizeStoreList(options.stores ?? [...STORAGE_ENTITY_NAMES]);
    const counts: StorageSnapshot["counts"] = {};
    const records: StorageSnapshot["records"] = {};

    for (const store of includedStores) {
      const allRecords = Array.from(getStore(this.stores, store).values());
      const visibleRecords = store === "settings" && !options.includeInternalSettings
        ? allRecords.filter((record) => !(record as { internal?: boolean }).internal)
        : allRecords;
      counts[store] = visibleRecords.length;
      if (visibleRecords.length > 0) {
        records[store] = cloneJsonSafe(visibleRecords) as never;
      }
    }

    return {
      formatVersion: STORAGE_SNAPSHOT_FORMAT_VERSION,
      sourceStorage: this.kind,
      sourceSchemaVersion: this.schemaVersion,
      createdAt: new Date().toISOString(),
      counts,
      records,
      metadata: {
        includedStores,
        notes: options.notes
      }
    };
  }

  async importSnapshot(snapshot: StorageSnapshot, options: StorageImportOptions): Promise<StorageImportResult> {
    this.assertReady();
    const validated = validateSnapshot(snapshot, options.stores);
    const targetStores = normalizeStoreList(options.stores ?? validated.includedStores);
    const result = createEmptyImportResult(options.mode);

    for (const store of targetStores) {
      const records = validated.records.get(store) ?? [];
      result.attempted[store] = records.length;
      const existing = getStore(this.stores, store);
      if (options.mode === "merge" && options.preserveExisting) {
        result.skipped[store] = records.filter((record) => existing.has(getRecordPrimaryKey(store, record))).length;
        result.written[store] = records.length - (result.skipped[store] ?? 0);
      } else {
        result.written[store] = records.length;
      }
      result.failed[store] = 0;
    }

    if (options.mode === "preview" || options.validateOnly) {
      return result;
    }

    const nextStores = cloneAllStores(this.stores);
    try {
      applySnapshotToStores(nextStores, validated.records, targetStores, options);
    } catch (error) {
      throw storageError("STORAGE_IMPORT_FAILED", "Snapshot import failed before commit.", true, undefined, error);
    }

    this.stores = nextStores;
    return result;
  }

  async getSchemaVersion(): Promise<number> {
    return this.schemaVersion;
  }

  async healthCheck(): Promise<StorageHealthReport> {
    return {
      adapter: this.kind,
      available: true,
      opened: this.opened,
      schemaVersion: this.schemaVersion,
      writable: this.opened,
      capabilities: this.capabilities,
      warnings: [],
      checkedAt: new Date().toISOString()
    };
  }

  reset(): void {
    this.stores = createEmptyStores();
  }

  seed<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): void {
    const nextStores = cloneAllStores(this.stores);
    bulkPutIntoStores(nextStores, store, values);
    this.stores = nextStores;
  }

  dump<K extends StorageEntityName>(store: K): StorageRecordMap[K][] {
    return getAllFromStores(this.stores, store);
  }

  private assertReady(options: { allowActiveTransaction?: boolean } = {}): void {
    if (!this.opened) {
      throw storageError("STORAGE_UNAVAILABLE", "MemoryAdapter is not open. Call open() before accessing data.", true);
    }
    if (this.transactionActive && options.allowActiveTransaction !== true) {
      throw storageError("STORAGE_LOCKED", "MemoryAdapter is busy with an active transaction.", true);
    }
  }
}

export function createMemoryAdapter(options?: MemoryAdapterOptions): MemoryAdapter {
  return new MemoryAdapter(options);
}

export function getRecordPrimaryKey<K extends StorageEntityName>(store: K, value: StorageRecordMap[K] | unknown): StoragePrimaryKey {
  assertStoreName(store);
  assertPlainObject(value, `Record for ${store} must be a JSON-safe object.`);
  const keyField = STORE_PRIMARY_KEYS[store];
  const key = (value as Record<string, unknown>)[keyField];
  if ((typeof key !== "string" && typeof key !== "number") || key === "") {
    throw storageError("STORAGE_VALIDATION_FAILED", `Record for ${store} is missing a valid primary key.`, true, store);
  }
  return key;
}

function createMemoryTransaction(stores: StoreData, declaredStores: StorageEntityName[], mode: StorageTransactionMode): StorageTransaction {
  const declared = new Set(declaredStores);

  function assertDeclared(store: StorageEntityName): void {
    if (!declared.has(store)) {
      throw storageError("STORAGE_TRANSACTION_FAILED", `Transaction did not declare access to ${store}.`, true, store);
    }
  }

  function assertWritable(store: StorageEntityName): void {
    if (mode === "readonly") {
      throw storageError("STORAGE_TRANSACTION_FAILED", `Readonly transaction cannot write to ${store}.`, true, store);
    }
  }

  return {
    async get(store, id) {
      assertDeclared(store);
      return getFromStores(stores, store, id);
    },
    async getAll(store, options) {
      assertDeclared(store);
      return getAllFromStores(stores, store, options);
    },
    async query(store, query) {
      assertDeclared(store);
      return queryStores(stores, store, query);
    },
    async put(store, value) {
      assertDeclared(store);
      assertWritable(store);
      putIntoStores(stores, store, value);
    },
    async bulkPut(store, values) {
      assertDeclared(store);
      assertWritable(store);
      return bulkPutIntoStores(stores, store, values);
    },
    async delete(store, id) {
      assertDeclared(store);
      assertWritable(store);
      deleteFromStores(stores, store, id);
    },
    async clear(store) {
      assertDeclared(store);
      assertWritable(store);
      clearStore(stores, store);
    }
  };
}

function getFromStores<K extends StorageEntityName>(stores: StoreData, store: K, id: StoragePrimaryKey): StorageRecordMap[K] | undefined {
  assertStoreName(store);
  const record = getStore(stores, store).get(id);
  return record === undefined ? undefined : cloneJsonSafe(record) as StorageRecordMap[K];
}

function getAllFromStores<K extends StorageEntityName>(stores: StoreData, store: K, options: StorageQueryOptions<K> = {}): StorageRecordMap[K][] {
  assertStoreName(store);
  validatePaging(options.limit, options.offset);
  let records = Array.from(getStore(stores, store).values());
  if (options.orderBy) {
    assertIndexAllowed(store, options.orderBy);
    records = sortRecords(store, records, options.orderBy, options.direction ?? "asc");
  }
  records = applyPaging(records, options.offset, options.limit);
  return cloneJsonSafe(records) as StorageRecordMap[K][];
}

function queryStores<K extends StorageEntityName>(stores: StoreData, store: K, query: StorageQuery<K>): StorageRecordMap[K][] {
  assertStoreName(store);
  validateQuery(store, query);
  let records = Array.from(getStore(stores, store).values());

  if (query.index) {
    records = records.filter((record) => matchesQuery(store, record, query));
    records = sortRecords(store, records, query.index, query.direction ?? "asc");
  }

  records = applyPaging(records, query.offset, query.limit);
  return cloneJsonSafe(records) as StorageRecordMap[K][];
}

function putIntoStores<K extends StorageEntityName>(stores: StoreData, store: K, value: StorageRecordMap[K]): void {
  assertStoreName(store);
  assertJsonSafe(value);
  const key = getRecordPrimaryKey(store, value);
  getStore(stores, store).set(key, cloneJsonSafe(value));
}

function bulkPutIntoStores<K extends StorageEntityName>(stores: StoreData, store: K, values: StorageRecordMap[K][]): StorageBulkWriteResult {
  assertStoreName(store);
  const prepared = new Map<StoragePrimaryKey, StorageRecordMap[K]>();
  const seen = new Set<StoragePrimaryKey>();

  values.forEach((value, index) => {
    try {
      assertJsonSafe(value);
      const key = getRecordPrimaryKey(store, value);
      if (seen.has(key)) {
        throw storageError("STORAGE_DUPLICATE_KEY", `Duplicate primary key in bulkPut at index ${index}.`, true, store);
      }
      seen.add(key);
      prepared.set(key, cloneJsonSafe(value) as StorageRecordMap[K]);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageError("STORAGE_VALIDATION_FAILED", `Invalid record in bulkPut at index ${index}.`, true, store, error);
    }
  });

  const target = getStore(stores, store);
  for (const [key, value] of prepared) {
    target.set(key, value);
  }

  return {
    attempted: values.length,
    written: values.length,
    skipped: 0,
    failed: 0
  };
}

function deleteFromStores<K extends StorageEntityName>(stores: StoreData, store: K, id: StoragePrimaryKey): void {
  assertStoreName(store);
  getStore(stores, store).delete(id);
}

function clearStore<K extends StorageEntityName>(stores: StoreData, store: K): void {
  assertStoreName(store);
  getStore(stores, store).clear();
}

function validateQuery<K extends StorageEntityName>(store: K, query: StorageQuery<K>): void {
  validatePaging(query.limit, query.offset);
  if (query.index) assertIndexAllowed(store, query.index);
  const hasRange = query.lowerBound !== undefined || query.upperBound !== undefined;
  if (query.equals !== undefined && hasRange) {
    throw storageError("STORAGE_VALIDATION_FAILED", "StorageQuery cannot combine equals with range bounds.", true, store);
  }
  if (!query.index && (query.equals !== undefined || hasRange)) {
    throw storageError("STORAGE_VALIDATION_FAILED", "StorageQuery with filters must specify an index.", true, store);
  }
}

function matchesQuery<K extends StorageEntityName>(store: K, record: unknown, query: StorageQuery<K>): boolean {
  if (!query.index) return true;
  const value = getIndexValue(store, record, query.index);
  if (value === undefined) return false;
  if (query.equals !== undefined) return compareValues(value, query.equals) === 0;
  if (query.lowerBound !== undefined) {
    const lower = compareValues(value, query.lowerBound);
    if (lower < 0 || (lower === 0 && query.includeLower === false)) return false;
  }
  if (query.upperBound !== undefined) {
    const upper = compareValues(value, query.upperBound);
    if (upper > 0 || (upper === 0 && query.includeUpper === false)) return false;
  }
  return true;
}

function sortRecords<K extends StorageEntityName>(store: K, records: unknown[], index: string, direction: "asc" | "desc"): unknown[] {
  return [...records].sort((a, b) => {
    const primary = compareMaybeUndefined(getIndexValue(store, a, index), getIndexValue(store, b, index));
    const secondary = primary === 0 ? compareValues(getRecordPrimaryKey(store, a), getRecordPrimaryKey(store, b)) : primary;
    return direction === "desc" ? -secondary : secondary;
  });
}

function getIndexValue<K extends StorageEntityName>(store: K, record: unknown, index: string): unknown {
  assertPlainObject(record, `Cannot read index ${index} from a non-object record.`);
  const source = record as Record<string, unknown>;
  if (store === "importBatchItems" && index === "importBatchId") return source.batchId;
  if (store === "savedItems" && index === "normalizedSourceUrl") return source.normalizedSourceUrl ?? normalizeSourceUrl(source.sourceUrl);
  if (store === "savedItems" && index === "sourceItemId") return source.sourceItemId;
  if (store === "savedItems" && index === "importedAt") return source.importedAt ?? source.createdAt;
  return source[index];
}

function validatePaging(limit?: number, offset?: number): void {
  for (const [name, value] of [["limit", limit], ["offset", offset]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw storageError("STORAGE_VALIDATION_FAILED", `${name} must be a non-negative integer.`, true);
    }
  }
}

function applyPaging(records: unknown[], offset = 0, limit?: number): unknown[] {
  if (limit === 0) return [];
  return records.slice(offset, limit === undefined ? undefined : offset + limit);
}

function compareMaybeUndefined(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return compareValues(a, b);
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function validateSnapshot(snapshot: StorageSnapshot, requestedStores?: StorageEntityName[]): { includedStores: StorageEntityName[]; records: Map<StorageEntityName, unknown[]> } {
  assertPlainObject(snapshot, "StorageSnapshot must be an object.");
  assertJsonSafe(snapshot);
  if (snapshot.formatVersion !== STORAGE_SNAPSHOT_FORMAT_VERSION) {
    throw storageError("STORAGE_SNAPSHOT_INVALID", "Unsupported StorageSnapshot formatVersion.", true);
  }
  if (typeof snapshot.sourceSchemaVersion !== "number" || snapshot.sourceSchemaVersion < 0) {
    throw storageError("STORAGE_SNAPSHOT_INVALID", "StorageSnapshot sourceSchemaVersion must be a non-negative number.", true);
  }
  if (typeof snapshot.createdAt !== "string" || Number.isNaN(Date.parse(snapshot.createdAt))) {
    throw storageError("STORAGE_SNAPSHOT_INVALID", "StorageSnapshot createdAt must be an ISO date string.", true);
  }

  const records = new Map<StorageEntityName, unknown[]>();
  const recordEntries = Object.entries(snapshot.records ?? {});
  const requested = requestedStores ? new Set(normalizeStoreList(requestedStores)) : undefined;

  for (const [storeName, value] of recordEntries) {
    const store = assertStoreName(storeName);
    if (requested && !requested.has(store)) continue;
    if (!Array.isArray(value)) {
      throw storageError("STORAGE_SNAPSHOT_INVALID", `StorageSnapshot records.${store} must be an array.`, true, store);
    }
    const expected = snapshot.counts?.[store];
    if (expected !== undefined && expected !== value.length) {
      throw storageError("STORAGE_SNAPSHOT_INVALID", `StorageSnapshot count mismatch for ${store}.`, true, store);
    }
    value.forEach((record) => {
      assertJsonSafe(record);
      getRecordPrimaryKey(store, record);
    });
    records.set(store, cloneJsonSafe(value));
  }

  for (const [storeName, count] of Object.entries(snapshot.counts ?? {})) {
    const store = assertStoreName(storeName);
    if (requested && !requested.has(store)) continue;
    if (typeof count !== "number" || count < 0) {
      throw storageError("STORAGE_SNAPSHOT_INVALID", `StorageSnapshot count for ${store} must be a non-negative number.`, true, store);
    }
    if (count > 0 && !records.has(store)) {
      throw storageError("STORAGE_SNAPSHOT_INVALID", `StorageSnapshot count for ${store} is positive but records are missing.`, true, store);
    }
  }

  return {
    includedStores: requestedStores ? normalizeStoreList(requestedStores) : Array.from(records.keys()),
    records
  };
}

function applySnapshotToStores(
  stores: StoreData,
  records: Map<StorageEntityName, unknown[]>,
  targetStores: StorageEntityName[],
  options: StorageImportOptions
): void {
  for (const store of targetStores) {
    const incoming = records.get(store);
    if (!incoming) continue;
    const target = getStore(stores, store);
    if (options.mode === "replace" || options.mode === "staging") target.clear();

    for (const record of incoming) {
      const key = getRecordPrimaryKey(store, record);
      if (options.mode === "merge" && options.preserveExisting && target.has(key)) continue;
      target.set(key, cloneJsonSafe(record));
    }
  }
}

function createEmptyImportResult(mode: StorageImportOptions["mode"]): StorageImportResult {
  return {
    mode,
    attempted: {},
    written: {},
    skipped: {},
    failed: {},
    warnings: [],
    rollbackAvailable: mode !== "preview"
  };
}

function createEmptyStores(): StoreData {
  return new Map(STORAGE_ENTITY_NAMES.map((store) => [store, new Map()]));
}

function cloneSelectedStores(source: StoreData, stores: StorageEntityName[]): StoreData {
  const target = createEmptyStores();
  for (const store of stores) {
    target.set(store, cloneStoreMap(getStore(source, store)));
  }
  return target;
}

function cloneAllStores(source: StoreData): StoreData {
  return cloneSelectedStores(source, [...STORAGE_ENTITY_NAMES]);
}

function cloneStoreMap(source: Map<StoragePrimaryKey, unknown>): Map<StoragePrimaryKey, unknown> {
  return new Map(Array.from(source.entries()).map(([key, value]) => [key, cloneJsonSafe(value)]));
}

function getStore(stores: StoreData, store: StorageEntityName): Map<StoragePrimaryKey, unknown> {
  const existing = stores.get(assertStoreName(store));
  if (!existing) {
    throw storageError("STORAGE_VALIDATION_FAILED", `Unknown storage store ${store}.`, false, store);
  }
  return existing;
}

function normalizeStoreList(stores: readonly StorageEntityName[]): StorageEntityName[] {
  const seen = new Set<StorageEntityName>();
  return stores.map((store) => assertStoreName(store)).filter((store) => {
    if (seen.has(store)) return false;
    seen.add(store);
    return true;
  });
}

function assertStoreName(value: unknown): StorageEntityName {
  if (typeof value !== "string" || !STORAGE_ENTITY_NAMES.includes(value as StorageEntityName)) {
    throw storageError("STORAGE_VALIDATION_FAILED", "Unknown storage store.", false);
  }
  return value as StorageEntityName;
}

function assertIndexAllowed<K extends StorageEntityName>(store: K, index: unknown): void {
  if (typeof index !== "string" || !(STORAGE_INDEXES[store] as readonly string[]).includes(index)) {
    throw storageError("STORAGE_VALIDATION_FAILED", `Index is not allowed for ${store}.`, true, store);
  }
}

function assertJsonSafe(value: unknown, seen = new WeakSet<object>()): void {
  assertSharedJsonSafe(value, { adapter: "memory", code: "STORAGE_VALIDATION_FAILED", recoverable: true }, seen);
}

function assertPlainObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw storageError("STORAGE_VALIDATION_FAILED", message, true);
  }
}

function cloneJsonSafe<T>(value: T): T {
  return cloneSharedJsonSafe(value, { adapter: "memory", code: "STORAGE_VALIDATION_FAILED", recoverable: true });
}

function normalizeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function storageError(code: StorageErrorCode, message: string, recoverable: boolean, store?: StorageEntityName, cause?: unknown): StorageError {
  return new StorageError({
    adapter: "memory",
    code,
    message,
    recoverable,
    store,
    cause
  });
}
