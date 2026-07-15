import {
  INDEXED_DB_TARGET_CAPABILITIES,
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
import { createMemoryAdapter, getRecordPrimaryKey } from "./memory-adapter";

export const DEFAULT_INDEXED_DB_NAME = "collection-revival-local";
export const DEFAULT_INDEXED_DB_SCHEMA_VERSION = 1;

const STORAGE_SNAPSHOT_FORMAT_VERSION = 1;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type IndexedDbFactory = IDBFactory;
type KeyRangeFactory = typeof IDBKeyRange;
type IdbSource = IDBObjectStore | IDBIndex;

export interface IndexedDbAdapterOptions {
  databaseName?: string;
  schemaVersion?: number;
  indexedDBFactory?: IndexedDbFactory;
  keyRangeFactory?: KeyRangeFactory;
  appVersion?: string;
}

export const INDEXED_DB_INDEX_KEY_PATHS: { readonly [K in StorageEntityName]: Readonly<Record<string, string>> } = {
  savedItems: {
    id: "id",
    sourceItemId: "sourceItemId",
    normalizedSourceUrl: "normalizedSourceUrl",
    contentDomain: "contentDomain",
    contentSubDomain: "contentSubDomain",
    savedIntent: "savedIntent",
    status: "status",
    importedAt: "createdAt",
    updatedAt: "updatedAt"
  },
  importBatches: {
    id: "id",
    source: "source",
    status: "status",
    createdAt: "createdAt"
  },
  importBatchItems: {
    id: "id",
    importBatchId: "batchId",
    normalizedSourceUrl: "normalizedSourceUrl",
    status: "status"
  },
  smartAlbums: {
    id: "id",
    status: "status",
    albumType: "albumType",
    updatedAt: "updatedAt"
  },
  actionCards: {
    id: "id",
    savedItemId: "savedItemId",
    status: "status",
    createdAt: "createdAt"
  },
  planCards: {
    id: "id",
    savedItemId: "savedItemId",
    actionCardId: "actionCardId",
    plannedDate: "plannedDate",
    status: "status"
  },
  classificationCorrections: {
    id: "id",
    savedItemId: "savedItemId",
    createdAt: "createdAt"
  },
  searchLogs: {
    id: "id",
    createdAt: "createdAt"
  },
  settings: {
    id: "id",
    key: "key",
    category: "category",
    internal: "internal",
    updatedAt: "updatedAt"
  },
  migrationMetadata: {
    id: "id",
    status: "status",
    createdAt: "startedAt"
  },
  backups: {
    id: "id",
    createdAt: "createdAt",
    sourceStorage: "sourceStorage",
    sourceSchemaVersion: "sourceSchemaVersion"
  }
};

export class IndexedDbAdapter implements StorageAdapter {
  readonly kind: StorageKind = "indexedDB";
  readonly capabilities: StorageCapabilities = INDEXED_DB_TARGET_CAPABILITIES;

  readonly databaseName: string;
  private readonly schemaVersion: number;
  private readonly indexedDBFactory?: IndexedDbFactory;
  private readonly keyRangeFactory?: KeyRangeFactory;
  private readonly appVersion?: string;
  private db?: IDBDatabase;
  private transactionActive = false;

  constructor(options: IndexedDbAdapterOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_INDEXED_DB_NAME;
    this.schemaVersion = options.schemaVersion ?? DEFAULT_INDEXED_DB_SCHEMA_VERSION;
    this.indexedDBFactory = options.indexedDBFactory ?? globalThis.indexedDB;
    this.keyRangeFactory = options.keyRangeFactory ?? globalThis.IDBKeyRange;
    this.appVersion = options.appVersion;
  }

  async open(): Promise<void> {
    if (this.db) return;
    const factory = this.getFactory();
    if (!factory) {
      throw storageError("STORAGE_OPEN_FAILED", "IndexedDB is not available in this environment.", true);
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const request = factory.open(this.databaseName, this.schemaVersion);

      request.onupgradeneeded = () => {
        createSchema(request.result, request.transaction);
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        this.db = request.result;
        this.db.onversionchange = () => {
          this.close();
        };
        settled = true;
        resolve();
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(mapIdbError("STORAGE_OPEN_FAILED", request.error, undefined, "Failed to open IndexedDB database."));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(storageError("STORAGE_LOCKED", "IndexedDB open request is blocked by another connection.", true));
      };
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.getFactory() && this.getKeyRangeFactory());
  }

  async get<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<StorageRecordMap[K] | undefined> {
    return this.runNativeTransaction([store], "readonly", async (tx) => {
      const record = await requestToPromise(tx.objectStore(store).get(id), "STORAGE_READ_FAILED", store);
      return record === undefined ? undefined : cloneJsonSafe(record) as StorageRecordMap[K];
    });
  }

  async getAll<K extends StorageEntityName>(store: K, options: StorageQueryOptions<K> = {}): Promise<StorageRecordMap[K][]> {
    validatePaging(options.limit, options.offset);
    if (options.orderBy) assertIndexAllowed(store, options.orderBy);
    return this.runNativeTransaction([store], "readonly", async (tx) => {
      const objectStore = tx.objectStore(store);
      const source = options.orderBy ? getCursorSource(objectStore, store, options.orderBy) : objectStore;
      const records = await collectCursor(source, undefined, options.direction ?? "asc", options.offset, options.limit, store);
      return cloneJsonSafe(records) as StorageRecordMap[K][];
    });
  }

  async query<K extends StorageEntityName>(store: K, query: StorageQuery<K>): Promise<StorageRecordMap[K][]> {
    validateQuery(store, query);
    if (!query.index) {
      return this.getAll(store, query);
    }

    const index = query.index;
    return this.runNativeTransaction([store], "readonly", async (tx) => {
      const objectStore = tx.objectStore(store);
      const source = getCursorSource(objectStore, store, index);
      const keyRange = buildKeyRange(this.getKeyRangeFactoryOrThrow(), query);
      const records = await collectCursor(source, keyRange, query.direction ?? "asc", query.offset, query.limit, store);
      return cloneJsonSafe(records) as StorageRecordMap[K][];
    });
  }

  async put<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): Promise<void> {
    assertJsonSafe(value);
    getRecordPrimaryKey(store, value);
    await this.runNativeTransaction([store], "readwrite", async (tx) => {
      await requestToPromise(tx.objectStore(store).put(cloneJsonSafe(value)), "STORAGE_WRITE_FAILED", store);
    });
  }

  async bulkPut<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): Promise<StorageBulkWriteResult> {
    const prepared = prepareBulkRecords(store, values);
    await this.runNativeTransaction([store], "readwrite", async (tx) => {
      const objectStore = tx.objectStore(store);
      for (const value of prepared) {
        await requestToPromise(objectStore.put(value), "STORAGE_WRITE_FAILED", store);
      }
    });
    return {
      attempted: values.length,
      written: values.length,
      skipped: 0,
      failed: 0
    };
  }

  async delete<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<void> {
    await this.runNativeTransaction([store], "readwrite", async (tx) => {
      await requestToPromise(tx.objectStore(store).delete(id), "STORAGE_DELETE_FAILED", store);
    });
  }

  async clear<K extends StorageEntityName>(store: K): Promise<void> {
    await this.runNativeTransaction([store], "readwrite", async (tx) => {
      await requestToPromise(tx.objectStore(store).clear(), "STORAGE_CLEAR_FAILED", store);
    });
  }

  async transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    if (this.transactionActive) {
      throw storageError("STORAGE_NOT_SUPPORTED", "Nested IndexedDbAdapter transactions are not supported.", true);
    }
    const declaredStores = normalizeStoreList(stores);
    if (declaredStores.length === 0) {
      throw storageError("STORAGE_VALIDATION_FAILED", "IndexedDB transaction requires at least one store.", true);
    }

    return this.runNativeTransaction(declaredStores, mode, async (nativeTx) => {
      this.transactionActive = true;
      const tx = createIndexedDbTransaction(nativeTx, declaredStores, mode, this.getKeyRangeFactoryOrThrow());
      try {
        return await operation(tx);
      } finally {
        this.transactionActive = false;
      }
    });
  }

  async exportSnapshot(options: StorageSnapshotOptions = {}): Promise<StorageSnapshot> {
    const stores = normalizeStoreList(options.stores ?? [...STORAGE_ENTITY_NAMES]);
    try {
      return await this.runNativeTransaction(stores, "readonly", async (tx) => {
        const counts: StorageSnapshot["counts"] = {};
        const records: StorageSnapshot["records"] = {};

        for (const store of stores) {
          const allRecords = await collectCursor(tx.objectStore(store), undefined, "asc", undefined, undefined, store);
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
          sourceSchemaVersion: await this.getSchemaVersion(),
          createdAt: new Date().toISOString(),
          appVersion: this.appVersion,
          counts,
          records,
          metadata: {
            includedStores: stores,
            notes: options.notes
          }
        };
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageError("STORAGE_EXPORT_FAILED", "IndexedDB Snapshot export failed.", true, undefined, error);
    }
  }

  async importSnapshot(snapshot: StorageSnapshot, options: StorageImportOptions): Promise<StorageImportResult> {
    const stagedSnapshot = await this.validateSnapshotInMemory(snapshot, options);
    const targetStores = normalizeStoreList(options.stores ?? Object.keys(stagedSnapshot.records ?? {}) as StorageEntityName[]);
    const result = await this.createImportResult(stagedSnapshot, targetStores, options);

    if (options.mode === "preview" || options.validateOnly) {
      return result;
    }

    if (targetStores.length === 0) {
      return result;
    }

    await this.runNativeTransaction(targetStores, "readwrite", async (tx) => {
      for (const store of targetStores) {
        const incoming = stagedSnapshot.records[store] ?? [];
        if (incoming.length === 0) continue;
        const objectStore = tx.objectStore(store);
        if (options.mode === "replace" || options.mode === "staging") {
          await requestToPromise(objectStore.clear(), "STORAGE_CLEAR_FAILED", store);
        }
        for (const record of incoming) {
          const key = getRecordPrimaryKey(store, record);
          if (options.mode === "merge" && options.preserveExisting) {
            const existing = await requestToPromise(objectStore.get(key), "STORAGE_READ_FAILED", store);
            if (existing !== undefined) continue;
          }
          await requestToPromise(objectStore.put(cloneJsonSafe(record)), "STORAGE_WRITE_FAILED", store);
        }
      }
    });

    return result;
  }

  async getSchemaVersion(): Promise<number> {
    return this.db?.version ?? this.schemaVersion;
  }

  async healthCheck(): Promise<StorageHealthReport> {
    const available = await this.isAvailable();
    return {
      adapter: this.kind,
      available,
      opened: Boolean(this.db),
      schemaVersion: this.db?.version ?? this.schemaVersion,
      writable: Boolean(this.db),
      quotaWarning: undefined,
      capabilities: this.capabilities,
      warnings: available ? [] : ["IndexedDB is not available in this environment."],
      checkedAt: new Date().toISOString()
    };
  }

  private async runNativeTransaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = this.ensureOpen();
    const declaredStores = normalizeStoreList(stores);
    let tx: IDBTransaction;
    try {
      tx = db.transaction(declaredStores, mode);
    } catch (error) {
      throw mapIdbError("STORAGE_TRANSACTION_FAILED", error, undefined, "Failed to start IndexedDB transaction.");
    }

    const done = transactionDone(tx);
    try {
      const result = await operation(tx);
      await done;
      return result;
    } catch (error) {
      try {
        if (tx.error === null) tx.abort();
      } catch {
        // Ignore abort races; the original error is safer and more useful.
      }
      await done.catch(() => undefined);
      if (error instanceof StorageError) {
        throw storageError("STORAGE_TRANSACTION_FAILED", error.message, error.recoverable, error.store, error);
      }
      throw storageError("STORAGE_TRANSACTION_FAILED", "IndexedDB transaction failed and was rolled back.", true, undefined, error);
    }
  }

  private ensureOpen(): IDBDatabase {
    if (!this.db) {
      throw storageError("STORAGE_UNAVAILABLE", "IndexedDbAdapter is not open. Call open() before accessing data.", true);
    }
    return this.db;
  }

  private getFactory(): IndexedDbFactory | undefined {
    return this.indexedDBFactory;
  }

  private getKeyRangeFactory(): KeyRangeFactory | undefined {
    return this.keyRangeFactory;
  }

  private getKeyRangeFactoryOrThrow(): KeyRangeFactory {
    const keyRangeFactory = this.getKeyRangeFactory();
    if (!keyRangeFactory) {
      throw storageError("STORAGE_UNAVAILABLE", "IDBKeyRange is not available in this environment.", true);
    }
    return keyRangeFactory;
  }

  private async validateSnapshotInMemory(snapshot: StorageSnapshot, options: StorageImportOptions): Promise<StorageSnapshot> {
    const stores = normalizeStoreList(options.stores ?? Object.keys(snapshot.records ?? {}) as StorageEntityName[]);
    const memory = createMemoryAdapter({ schemaVersion: this.schemaVersion });
    await memory.open();
    await memory.importSnapshot(snapshot, { ...options, mode: "staging", stores });
    return memory.exportSnapshot({ stores, includeInternalSettings: true });
  }

  private async createImportResult(snapshot: StorageSnapshot, stores: StorageEntityName[], options: StorageImportOptions): Promise<StorageImportResult> {
    const result: StorageImportResult = {
      mode: options.mode,
      attempted: {},
      written: {},
      skipped: {},
      failed: {},
      warnings: [],
      rollbackAvailable: options.mode !== "preview"
    };

    for (const store of stores) {
      const records = snapshot.records[store] ?? [];
      result.attempted[store] = records.length;
      result.failed[store] = 0;
      if (options.mode === "merge" && options.preserveExisting) {
        const skipped = await this.countExistingRecords(store, records);
        result.skipped[store] = skipped;
        result.written[store] = records.length - skipped;
      } else {
        result.skipped[store] = 0;
        result.written[store] = records.length;
      }
    }
    return result;
  }

  private async countExistingRecords<K extends StorageEntityName>(store: K, records: StorageRecordMap[K][]): Promise<number> {
    if (records.length === 0) return 0;
    return this.runNativeTransaction([store], "readonly", async (tx) => {
      let count = 0;
      const objectStore = tx.objectStore(store);
      for (const record of records) {
        const existing = await requestToPromise(objectStore.get(getRecordPrimaryKey(store, record)), "STORAGE_READ_FAILED", store);
        if (existing !== undefined) count += 1;
      }
      return count;
    });
  }
}

export function createIndexedDbAdapter(options?: IndexedDbAdapterOptions): IndexedDbAdapter {
  return new IndexedDbAdapter(options);
}

export function deleteIndexedDbDatabase(databaseName: string, factory: IndexedDbFactory = globalThis.indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      resolve();
      return;
    }
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(mapIdbError("STORAGE_DELETE_FAILED", request.error, undefined, "Failed to delete IndexedDB test database."));
    request.onblocked = () => reject(storageError("STORAGE_LOCKED", "IndexedDB deleteDatabase request is blocked by an open connection.", true));
  });
}

function createSchema(db: IDBDatabase, transaction: IDBTransaction | null): void {
  for (const store of STORAGE_ENTITY_NAMES) {
    const keyPath = STORE_PRIMARY_KEYS[store];
    const objectStore = db.objectStoreNames.contains(store)
      ? undefined
      : db.createObjectStore(store, { keyPath });
    const targetStore = objectStore ?? getUpgradeObjectStore(transaction, store);
    createIndexes(store, targetStore);
  }
}

function getUpgradeObjectStore(transaction: IDBTransaction | null, store: StorageEntityName): IDBObjectStore {
  if (!transaction) {
    throw storageError("STORAGE_SCHEMA_MISMATCH", "IndexedDB upgrade transaction is unavailable.", true, store);
  }
  return transaction.objectStore(store);
}

function createIndexes(store: StorageEntityName, objectStore: IDBObjectStore): void {
  for (const indexName of STORAGE_INDEXES[store]) {
    if (objectStore.indexNames.contains(indexName)) continue;
    objectStore.createIndex(indexName, INDEXED_DB_INDEX_KEY_PATHS[store][indexName], { unique: false });
  }
}

function createIndexedDbTransaction(
  nativeTx: IDBTransaction,
  declaredStores: StorageEntityName[],
  mode: StorageTransactionMode,
  keyRangeFactory: KeyRangeFactory
): StorageTransaction {
  const declared = new Set(declaredStores);
  const assertDeclared = (store: StorageEntityName): void => {
    if (!declared.has(store)) {
      throw storageError("STORAGE_TRANSACTION_FAILED", `Transaction did not declare access to ${store}.`, true, store);
    }
  };
  const assertWritable = (store: StorageEntityName): void => {
    if (mode === "readonly") {
      throw storageError("STORAGE_TRANSACTION_FAILED", `Readonly transaction cannot write to ${store}.`, true, store);
    }
  };

  return {
    async get(store, id) {
      assertDeclared(store);
      const record = await requestToPromise(nativeTx.objectStore(store).get(id), "STORAGE_READ_FAILED", store);
      return record === undefined ? undefined : cloneJsonSafe(record) as never;
    },
    async getAll(store, options) {
      assertDeclared(store);
      validatePaging(options?.limit, options?.offset);
      if (options?.orderBy) assertIndexAllowed(store, options.orderBy);
      const objectStore = nativeTx.objectStore(store);
      const source = options?.orderBy ? getCursorSource(objectStore, store, options.orderBy) : objectStore;
      const records = await collectCursor(source, undefined, options?.direction ?? "asc", options?.offset, options?.limit, store);
      return cloneJsonSafe(records) as never;
    },
    async query(store, query) {
      assertDeclared(store);
      validateQuery(store, query);
      if (!query.index) {
        const records = await collectCursor(nativeTx.objectStore(store), undefined, query.direction ?? "asc", query.offset, query.limit, store);
        return cloneJsonSafe(records) as never;
      }
      const source = getCursorSource(nativeTx.objectStore(store), store, query.index);
      const records = await collectCursor(source, buildKeyRange(keyRangeFactory, query), query.direction ?? "asc", query.offset, query.limit, store);
      return cloneJsonSafe(records) as never;
    },
    async put(store, value) {
      assertDeclared(store);
      assertWritable(store);
      assertJsonSafe(value);
      getRecordPrimaryKey(store, value);
      await requestToPromise(nativeTx.objectStore(store).put(cloneJsonSafe(value)), "STORAGE_WRITE_FAILED", store);
    },
    async bulkPut(store, values) {
      assertDeclared(store);
      assertWritable(store);
      const prepared = prepareBulkRecords(store, values);
      const objectStore = nativeTx.objectStore(store);
      for (const value of prepared) {
        await requestToPromise(objectStore.put(value), "STORAGE_WRITE_FAILED", store);
      }
      return {
        attempted: values.length,
        written: values.length,
        skipped: 0,
        failed: 0
      };
    },
    async delete(store, id) {
      assertDeclared(store);
      assertWritable(store);
      await requestToPromise(nativeTx.objectStore(store).delete(id), "STORAGE_DELETE_FAILED", store);
    },
    async clear(store) {
      assertDeclared(store);
      assertWritable(store);
      await requestToPromise(nativeTx.objectStore(store).clear(), "STORAGE_CLEAR_FAILED", store);
    }
  };
}

function getCursorSource<K extends StorageEntityName>(objectStore: IDBObjectStore, store: K, index: string): IdbSource {
  assertIndexAllowed(store, index);
  const primaryKey = STORE_PRIMARY_KEYS[store];
  if (index === primaryKey) return objectStore;
  return objectStore.index(index);
}

function collectCursor(
  source: IdbSource,
  range: IDBKeyRange | undefined,
  direction: "asc" | "desc",
  offset = 0,
  limit?: number,
  store?: StorageEntityName
): Promise<unknown[]> {
  validatePaging(limit, offset);
  if (limit === 0) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const records: unknown[] = [];
    let skipped = offset === 0;
    let done = false;
    let request: IDBRequest<IDBCursorWithValue | null>;
    try {
      request = source.openCursor(range, direction === "desc" ? "prev" : "next");
    } catch (error) {
      reject(mapIdbError("STORAGE_READ_FAILED", error, store, "Failed to open IndexedDB cursor."));
      return;
    }

    request.onerror = () => reject(mapIdbError("STORAGE_READ_FAILED", request.error, store, "IndexedDB cursor read failed."));
    request.onsuccess = () => {
      if (done) return;
      const cursor = request.result;
      if (!cursor) {
        done = true;
        resolve(records);
        return;
      }
      if (!skipped && offset > 0) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      records.push(cloneJsonSafe(cursor.value));
      if (limit !== undefined && records.length >= limit) {
        done = true;
        resolve(records);
        return;
      }
      cursor.continue();
    };
  });
}

function buildKeyRange<K extends StorageEntityName>(keyRangeFactory: KeyRangeFactory, query: StorageQuery<K>): IDBKeyRange | undefined {
  if (query.equals !== undefined) {
    return keyRangeFactory.only(query.equals as IDBValidKey);
  }
  const hasLower = query.lowerBound !== undefined;
  const hasUpper = query.upperBound !== undefined;
  if (hasLower && hasUpper) {
    return keyRangeFactory.bound(
      query.lowerBound as IDBValidKey,
      query.upperBound as IDBValidKey,
      query.includeLower === false,
      query.includeUpper === false
    );
  }
  if (hasLower) {
    return keyRangeFactory.lowerBound(query.lowerBound as IDBValidKey, query.includeLower === false);
  }
  if (hasUpper) {
    return keyRangeFactory.upperBound(query.upperBound as IDBValidKey, query.includeUpper === false);
  }
  return undefined;
}

function requestToPromise<T>(request: IDBRequest<T>, fallbackCode: StorageErrorCode, store?: StorageEntityName): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapIdbError(fallbackCode, request.error, store, "IndexedDB request failed."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapIdbError("STORAGE_TRANSACTION_FAILED", tx.error, undefined, "IndexedDB transaction failed."));
    tx.onabort = () => reject(mapIdbError("STORAGE_TRANSACTION_FAILED", tx.error, undefined, "IndexedDB transaction aborted."));
  });
}

function prepareBulkRecords<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): StorageRecordMap[K][] {
  const seen = new Set<StoragePrimaryKey>();
  return values.map((value, index) => {
    assertJsonSafe(value);
    const key = getRecordPrimaryKey(store, value);
    if (seen.has(key)) {
      throw storageError("STORAGE_DUPLICATE_KEY", `Duplicate primary key in bulkPut at index ${index}.`, true, store);
    }
    seen.add(key);
    return cloneJsonSafe(value);
  });
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

function validatePaging(limit?: number, offset?: number): void {
  for (const [name, value] of [["limit", limit], ["offset", offset]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw storageError("STORAGE_VALIDATION_FAILED", `${name} must be a non-negative integer.`, true);
    }
  }
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
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return;
  if (kind === "undefined" || kind === "function" || kind === "symbol" || kind === "bigint") {
    throw storageError("STORAGE_VALIDATION_FAILED", "Storage records must be JSON-safe.", true);
  }
  if (kind !== "object") {
    throw storageError("STORAGE_VALIDATION_FAILED", "Storage records must be JSON-safe.", true);
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw storageError("STORAGE_VALIDATION_FAILED", "Storage records cannot contain circular references.", true);
  }
  seen.add(objectValue);

  if (Array.isArray(value)) {
    value.forEach((entry) => assertJsonSafe(entry, seen));
    seen.delete(objectValue);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw storageError("STORAGE_VALIDATION_FAILED", "Storage records must be plain JSON objects.", true);
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw storageError("STORAGE_VALIDATION_FAILED", "Storage records contain a blocked key.", true);
    }
    assertJsonSafe((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(objectValue);
}

function cloneJsonSafe<T>(value: T): T {
  assertJsonSafe(value);
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function mapIdbError(fallbackCode: StorageErrorCode, error: unknown, store?: StorageEntityName, fallbackMessage = "IndexedDB operation failed."): StorageError {
  if (error instanceof StorageError) return error;
  const name = getErrorName(error);
  const code = mapDomExceptionName(name, fallbackCode);
  return storageError(code, `${fallbackMessage}${name ? ` (${name})` : ""}`, isRecoverableStorageCode(code), store, error);
}

function getErrorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : undefined;
}

function mapDomExceptionName(name: string | undefined, fallbackCode: StorageErrorCode): StorageErrorCode {
  switch (name) {
    case "QuotaExceededError":
      return "STORAGE_QUOTA_EXCEEDED";
    case "ConstraintError":
      return "STORAGE_DUPLICATE_KEY";
    case "DataError":
      return "STORAGE_VALIDATION_FAILED";
    case "InvalidStateError":
      return "STORAGE_UNAVAILABLE";
    case "TransactionInactiveError":
    case "AbortError":
      return "STORAGE_TRANSACTION_FAILED";
    case "VersionError":
      return "STORAGE_SCHEMA_MISMATCH";
    default:
      return fallbackCode;
  }
}

function isRecoverableStorageCode(code: StorageErrorCode): boolean {
  return code !== "STORAGE_SCHEMA_MISMATCH";
}

function storageError(code: StorageErrorCode, message: string, recoverable: boolean, store?: StorageEntityName, cause?: unknown): StorageError {
  return new StorageError({
    adapter: "indexedDB",
    code,
    message,
    recoverable,
    store,
    cause
  });
}
