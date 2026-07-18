import type {
  ActionCard,
  ClassificationCorrection,
  ImportBatch,
  ImportBatchItem,
  PlanCard,
  SavedItem,
  SearchLog,
  SmartAlbum
} from "@revival/shared-types";
import type { StorageErrorCode } from "./errors";

export type StorageKind = "localStorage" | "indexedDB" | "memory" | "supabase";

export const STORAGE_ENTITY_NAMES = [
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
] as const;

export type StorageEntityName = (typeof STORAGE_ENTITY_NAMES)[number];
export type StoragePrimaryKey = string | number;

export const STORE_PRIMARY_KEYS = {
  savedItems: "id",
  importBatches: "id",
  importBatchItems: "id",
  smartAlbums: "id",
  actionCards: "id",
  planCards: "id",
  classificationCorrections: "id",
  searchLogs: "id",
  settings: "key",
  migrationMetadata: "id",
  backups: "id"
} as const satisfies Record<StorageEntityName, string>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StoredSetting {
  id: string;
  key: string;
  value: JsonValue;
  category: "product" | "appearance" | "storage" | "migration" | "internal";
  internal: boolean;
  updatedAt: string;
  schemaVersion: number;
}

export type StorageMigrationStatus =
  | "not_started"
  | "snapshot_created"
  | "preview_ready"
  | "user_confirmed"
  | "migrating"
  | "verifying"
  | "completed"
  | "failed"
  | "rolled_back";

export interface MigrationMetadata {
  id: string;
  sourceStorage: StorageKind;
  targetStorage: StorageKind;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  status: StorageMigrationStatus;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  rolledBackAt?: string;
  backupId?: string;
  errorCode?: StorageErrorCode;
  warnings: string[];
}

export type StorageActivationJournalStatus =
  | "preparing"
  | "prepared"
  | "switching"
  | "boot_verifying"
  | "committed"
  | "cancelled"
  | "prepare_failed"
  | "activation_failed";

export interface SafeBootVerificationSummary {
  verified: boolean;
  checkedAt: string;
  runtimeKind: "indexedDB";
  schemaVersion: number;
  targetRuntimeChecksumVerified: boolean;
  referencesVerified: boolean;
  blockingIssueCodes: string[];
  warningCodes: string[];
}

export interface SafeActivationPreflightSummary {
  eligible: boolean;
  checkedAt: string;
  blockingIssueCodes: string[];
  warningCodes: string[];
}

export interface StorageActivationJournalV1 {
  id: string;
  recordType: "activation";
  version: 1;
  activationId: string;
  migrationId: string;
  status: StorageActivationJournalStatus;
  sourceBackend: "localStorage";
  targetBackend: "indexedDB";
  sourceRawChecksum: string;
  sourceNormalizedChecksum: string;
  targetRuntimeChecksum: string;
  bootstrapRevisionBefore: number | null;
  bootstrapRevisionPrepared?: number;
  databaseName: "collection-revival-local";
  schemaVersion: 1;
  preflightSummary: SafeActivationPreflightSummary;
  createdAt: string;
  updatedAt: string;
  preparedAt?: string;
  switchingAt?: string;
  bootVerifyingAt?: string;
  committedAt?: string;
  cancelledAt?: string;
  failedAt?: string;
  activationFailedAt?: string;
  markerRevisionActivating?: number;
  markerRevisionCommitted?: number;
  bootVerificationSummary?: SafeBootVerificationSummary;
  errorCode?: string;
}

export type StorageMetadataRecord = MigrationMetadata | StorageActivationJournalV1;
export interface StorageBackup {
  id: string;
  sourceStorage: StorageKind;
  sourceSchemaVersion: number;
  createdAt: string;
  checksum?: string;
  formatVersion: number;
  snapshot: StorageSnapshot;
  notes?: string;
}

export interface StorageRecordMap {
  savedItems: SavedItem;
  importBatches: ImportBatch;
  importBatchItems: ImportBatchItem;
  smartAlbums: SmartAlbum;
  actionCards: ActionCard;
  planCards: PlanCard;
  classificationCorrections: ClassificationCorrection;
  searchLogs: SearchLog;
  settings: StoredSetting;
  migrationMetadata: StorageMetadataRecord;
  backups: StorageBackup;
}

export interface StorageIndexMap {
  savedItems:
    | "id"
    | "sourceItemId"
    | "normalizedSourceUrl"
    | "contentDomain"
    | "contentSubDomain"
    | "savedIntent"
    | "status"
    | "importedAt"
    | "updatedAt";
  importBatches: "id" | "source" | "status" | "createdAt";
  importBatchItems: "id" | "importBatchId" | "normalizedSourceUrl" | "status";
  smartAlbums: "id" | "status" | "albumType" | "updatedAt";
  actionCards: "id" | "savedItemId" | "status" | "createdAt";
  planCards: "id" | "savedItemId" | "actionCardId" | "plannedDate" | "status";
  classificationCorrections: "id" | "savedItemId" | "createdAt";
  searchLogs: "id" | "createdAt";
  settings: "id" | "key" | "category" | "internal" | "updatedAt";
  migrationMetadata: "id" | "status" | "createdAt";
  backups: "id" | "createdAt" | "sourceStorage" | "sourceSchemaVersion";
}

export type StorageIndexName<K extends StorageEntityName> = StorageIndexMap[K];
export type StorageIndexValue<K extends StorageEntityName> = StorageRecordMap[K][keyof StorageRecordMap[K]] | JsonPrimitive;

export const STORAGE_INDEXES: { readonly [K in StorageEntityName]: readonly StorageIndexName<K>[] } = {
  savedItems: ["id", "sourceItemId", "normalizedSourceUrl", "contentDomain", "contentSubDomain", "savedIntent", "status", "importedAt", "updatedAt"],
  importBatches: ["id", "source", "status", "createdAt"],
  importBatchItems: ["id", "importBatchId", "normalizedSourceUrl", "status"],
  smartAlbums: ["id", "status", "albumType", "updatedAt"],
  actionCards: ["id", "savedItemId", "status", "createdAt"],
  planCards: ["id", "savedItemId", "actionCardId", "plannedDate", "status"],
  classificationCorrections: ["id", "savedItemId", "createdAt"],
  searchLogs: ["id", "createdAt"],
  settings: ["id", "key", "category", "internal", "updatedAt"],
  migrationMetadata: ["id", "status", "createdAt"],
  backups: ["id", "createdAt", "sourceStorage", "sourceSchemaVersion"]
};

export interface StorageQueryOptions<K extends StorageEntityName> {
  limit?: number;
  offset?: number;
  orderBy?: StorageIndexName<K>;
  direction?: "asc" | "desc";
}

export interface StorageQuery<K extends StorageEntityName> {
  index?: StorageIndexName<K>;
  equals?: StorageIndexValue<K>;
  lowerBound?: StorageIndexValue<K>;
  upperBound?: StorageIndexValue<K>;
  includeLower?: boolean;
  includeUpper?: boolean;
  limit?: number;
  offset?: number;
  direction?: "asc" | "desc";
}

export type StorageTransactionMode = "readonly" | "readwrite";

export interface StorageBulkWriteError {
  index: number;
  id?: StoragePrimaryKey;
  code: StorageErrorCode;
  message: string;
}

export interface StorageBulkWriteResult {
  attempted: number;
  written: number;
  skipped: number;
  failed: number;
  errors?: StorageBulkWriteError[];
}

export interface StorageTransaction {
  get<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<StorageRecordMap[K] | undefined>;
  getAll<K extends StorageEntityName>(store: K, options?: StorageQueryOptions<K>): Promise<StorageRecordMap[K][]>;
  query<K extends StorageEntityName>(store: K, query: StorageQuery<K>): Promise<StorageRecordMap[K][]>;
  put<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): Promise<void>;
  bulkPut<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): Promise<StorageBulkWriteResult>;
  delete<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<void>;
  clear<K extends StorageEntityName>(store: K): Promise<void>;
}

export interface StorageCapabilities {
  transactions: boolean;
  indexes: boolean;
  snapshots: boolean;
  rollback: boolean;
  persistence: boolean;
  bulkWrite: boolean;
  queryRanges: boolean;
}

export const LOCAL_STORAGE_CONTRACT_CAPABILITIES: StorageCapabilities = {
  transactions: false,
  indexes: false,
  snapshots: false,
  rollback: false,
  persistence: true,
  bulkWrite: false,
  queryRanges: false
};

export const INDEXED_DB_TARGET_CAPABILITIES: StorageCapabilities = {
  transactions: true,
  indexes: true,
  snapshots: true,
  rollback: true,
  persistence: true,
  bulkWrite: true,
  queryRanges: true
};

export const MEMORY_TARGET_CAPABILITIES: StorageCapabilities = {
  transactions: true,
  indexes: true,
  snapshots: true,
  rollback: true,
  persistence: false,
  bulkWrite: true,
  queryRanges: true
};

export const SUPABASE_BLOCKED_CAPABILITIES: StorageCapabilities = {
  transactions: false,
  indexes: false,
  snapshots: false,
  rollback: false,
  persistence: false,
  bulkWrite: false,
  queryRanges: false
};

export interface StorageSnapshotMetadata {
  migrationId?: string;
  sourceAppVersion?: string;
  userInitiated?: boolean;
  notes?: string;
  includedStores?: StorageEntityName[];
}

export interface StorageSnapshot {
  formatVersion: number;
  sourceStorage: StorageKind;
  sourceSchemaVersion: number;
  createdAt: string;
  appVersion?: string;
  counts: Partial<Record<StorageEntityName, number>>;
  records: Partial<{
    [K in StorageEntityName]: StorageRecordMap[K][];
  }>;
  checksum?: string;
  metadata?: StorageSnapshotMetadata;
}

export type StorageImportMode = "preview" | "replace" | "merge" | "staging";

export interface StorageSnapshotOptions {
  stores?: StorageEntityName[];
  includeInternalSettings?: boolean;
  notes?: string;
}

export interface StorageImportOptions {
  mode: StorageImportMode;
  stores?: StorageEntityName[];
  validateOnly?: boolean;
  preserveExisting?: boolean;
}

export interface StorageImportResult {
  mode: StorageImportMode;
  attempted: Partial<Record<StorageEntityName, number>>;
  written: Partial<Record<StorageEntityName, number>>;
  skipped: Partial<Record<StorageEntityName, number>>;
  failed: Partial<Record<StorageEntityName, number>>;
  warnings: string[];
  rollbackAvailable: boolean;
}

export interface ActiveStorageMetadata {
  active: "localStorage" | "indexedDB";
  schemaVersion: number;
  migrationId?: string;
  switchedAt?: string;
  rollbackAvailable: boolean;
}

export interface StorageHealthReport {
  adapter: StorageKind;
  available: boolean;
  opened: boolean;
  schemaVersion?: number;
  writable?: boolean;
  quotaWarning?: boolean;
  capabilities: StorageCapabilities;
  warnings: string[];
  checkedAt: string;
}

export interface StorageAdapter {
  readonly kind: StorageKind;
  readonly capabilities: StorageCapabilities;
  open(): Promise<void>;
  close(): Promise<void>;
  isAvailable(): Promise<boolean>;
  get<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<StorageRecordMap[K] | undefined>;
  getAll<K extends StorageEntityName>(store: K, options?: StorageQueryOptions<K>): Promise<StorageRecordMap[K][]>;
  query<K extends StorageEntityName>(store: K, query: StorageQuery<K>): Promise<StorageRecordMap[K][]>;
  put<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): Promise<void>;
  bulkPut<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): Promise<StorageBulkWriteResult>;
  delete<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<void>;
  clear<K extends StorageEntityName>(store: K): Promise<void>;
  transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  exportSnapshot(options?: StorageSnapshotOptions): Promise<StorageSnapshot>;
  importSnapshot(snapshot: StorageSnapshot, options: StorageImportOptions): Promise<StorageImportResult>;
  getSchemaVersion(): Promise<number>;
  healthCheck(): Promise<StorageHealthReport>;
}
