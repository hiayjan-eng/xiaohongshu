import type { SavedItem } from "@revival/shared-types";
import {
  INDEXED_DB_TARGET_CAPABILITIES,
  LOCAL_STORAGE_CONTRACT_CAPABILITIES,
  MEMORY_TARGET_CAPABILITIES,
  STORAGE_ENTITY_NAMES,
  STORAGE_ERROR_CODES,
  STORAGE_INDEXES,
  SUPABASE_BLOCKED_CAPABILITIES,
  StorageError,
  type ActiveStorageMetadata,
  type StorageAdapter,
  type StorageBulkWriteError,
  type StorageCapabilities,
  type StorageEntityName,
  type StorageErrorCode,
  type StorageHealthReport,
  type StorageImportMode,
  type StorageImportResult,
  type StorageMigrationStatus,
  type StorageQuery,
  type StorageRecordMap,
  type StorageSnapshot,
  type StoredSetting
} from "../src/index";

const allStores: readonly StorageEntityName[] = STORAGE_ENTITY_NAMES;
const expectedStores = [
  "savedItems",
  "importBatches",
  "importBatchItems",
  "smartAlbums",
  "actionCards",
  "planCards",
  "classificationCorrections",
  "searchLogs",
  "settings",
  "migrationMetadata",
  "backups"
] as const satisfies readonly StorageEntityName[];

const _storeListIsTyped: readonly StorageEntityName[] = allStores;
const _expectedListIsTyped: readonly StorageEntityName[] = expectedStores;

type ResolvedRecordMap = { [K in StorageEntityName]: StorageRecordMap[K] };
type SavedItemRecord = ResolvedRecordMap["savedItems"];
const _savedItemRecordKeepsSharedType: SavedItem | undefined = undefined as SavedItemRecord | undefined;

const savedItemQuery: StorageQuery<"savedItems"> = {
  index: "contentDomain",
  equals: "AI 与效率",
  limit: 10,
  direction: "desc"
};

const planCardQuery: StorageQuery<"planCards"> = {
  index: "plannedDate",
  lowerBound: "2026-07-01",
  upperBound: "2026-07-31",
  includeLower: true,
  includeUpper: true
};

const _savedItemIndexes = STORAGE_INDEXES.savedItems;
const _planCardIndexes = STORAGE_INDEXES.planCards;

// @ts-expect-error Extension runtime state is intentionally outside the Web StorageAdapter boundary.
const extensionStore: StorageEntityName = "extensionScanCheckpoint";

const _invalidIndexQuery: StorageQuery<"savedItems"> = {
  // @ts-expect-error plannedDate is a PlanCard index, not a SavedItem index.
  index: "plannedDate"
};

const capabilities: StorageCapabilities = {
  transactions: true,
  indexes: true,
  snapshots: true,
  rollback: true,
  persistence: true,
  bulkWrite: true,
  queryRanges: true
};

const _localCapabilities: StorageCapabilities = LOCAL_STORAGE_CONTRACT_CAPABILITIES;
const _indexedDbCapabilities: StorageCapabilities = INDEXED_DB_TARGET_CAPABILITIES;
const _memoryCapabilities: StorageCapabilities = MEMORY_TARGET_CAPABILITIES;
const _supabaseCapabilities: StorageCapabilities = SUPABASE_BLOCKED_CAPABILITIES;
const _allCodes: readonly string[] = STORAGE_ERROR_CODES;

const error = new StorageError({
  adapter: "localStorage",
  code: "STORAGE_NOT_SUPPORTED",
  message: "Failed to read https://www.xiaohongshu.com/item?xsec_token=secret-token",
  recoverable: true,
  store: "savedItems"
});

const _errorIsError: Error = error;
const serializedError = error.toJSON();
const _safeErrorCode: StorageErrorCode = serializedError.code;
const _safeErrorStore: StorageEntityName | undefined = serializedError.store;

const setting: StoredSetting = {
  id: "setting_developerMode",
  key: "developerMode",
  value: true,
  category: "internal",
  internal: true,
  updatedAt: "2026-07-15T00:00:00.000Z",
  schemaVersion: 1
};

const snapshot: StorageSnapshot = {
  formatVersion: 1,
  sourceStorage: "localStorage",
  sourceSchemaVersion: 3,
  createdAt: "2026-07-15T00:00:00.000Z",
  counts: {
    settings: 1
  },
  records: {
    settings: [setting]
  },
  metadata: {
    userInitiated: true,
    includedStores: ["settings"]
  }
};

const _jsonSafeSnapshot: string = JSON.stringify(snapshot);
const _createdAtIsString: string = snapshot.createdAt;

const importMode: StorageImportMode = "staging";
const importResult: StorageImportResult = {
  mode: importMode,
  attempted: { settings: 1 },
  written: { settings: 1 },
  skipped: {},
  failed: {},
  warnings: [],
  rollbackAvailable: true
};

const activeStorage: ActiveStorageMetadata = {
  active: "indexedDB",
  schemaVersion: 1,
  migrationId: "migration_001",
  rollbackAvailable: true
};

// @ts-expect-error active storage can only be localStorage or indexedDB.
const invalidActiveStorage: ActiveStorageMetadata = { active: "supabase", schemaVersion: 1, rollbackAvailable: false };

const migrationStatuses: readonly StorageMigrationStatus[] = [
  "not_started",
  "snapshot_created",
  "preview_ready",
  "user_confirmed",
  "migrating",
  "verifying",
  "completed",
  "failed",
  "rolled_back"
];

const health: StorageHealthReport = {
  adapter: "memory",
  available: true,
  opened: true,
  schemaVersion: 1,
  capabilities,
  warnings: [],
  checkedAt: "2026-07-15T00:00:00.000Z"
};

const bulkError: StorageBulkWriteError = {
  index: 0,
  id: "item_001",
  code: "STORAGE_DUPLICATE_KEY",
  message: "Duplicate key"
};

declare const adapter: StorageAdapter;
void adapter.kind;
void adapter.capabilities;
void adapter.get("savedItems", "item_001");
void adapter.getAll("smartAlbums", { orderBy: "updatedAt", direction: "desc" });
void adapter.query("planCards", planCardQuery);
void adapter.bulkPut("settings", [setting]);
void adapter.healthCheck();
void savedItemQuery;
void importResult;
void activeStorage;
void migrationStatuses;
void health;
void bulkError;
