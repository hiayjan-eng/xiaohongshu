import type { ActionCard, ImportBatch, ImportBatchItem, Plan, RealUserTestRecord, SavedItem, SearchLog, SmartAlbum, Task } from "@revival/shared-types";
import {
  LOCAL_STORAGE_CONTRACT_CAPABILITIES,
  SUPABASE_BLOCKED_CAPABILITIES,
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
import { createStorageNotSupportedError, StorageError, type StorageErrorCode } from "./errors";

export * from "./contracts";
export * from "./errors";
export * from "./indexeddb-adapter";
export * from "./legacy-localstorage-snapshot";
export * from "./memory-adapter";
export * from "./migration-executor";
export * from "./migration-executor-errors";
export * from "./migration-lock";
export * from "./migration-preview";
export * from "./repositories";
export * from "./runtime-metadata";
export { canonicalJsonStringify } from "./json-utils";

export interface AchievementRecord {
  id: string;
  unlockedAt: string;
}

export interface LegacyEntityStorageAdapter {
  getSavedItems(): Promise<SavedItem[]>;
  saveSavedItem(item: SavedItem): Promise<void>;
  getActionCards(): Promise<ActionCard[]>;
  saveActionCard(card: ActionCard): Promise<void>;
  getImportBatches(): Promise<ImportBatch[]>;
  saveImportBatch(batch: ImportBatch): Promise<void>;
  getImportBatchItems(batchId?: string): Promise<ImportBatchItem[]>;
  saveImportBatchItem(item: ImportBatchItem): Promise<void>;
  getSmartAlbums(): Promise<SmartAlbum[]>;
  saveSmartAlbum(album: SmartAlbum): Promise<void>;
  getTasks(actionCardId?: string): Promise<Task[]>;
  saveTask(task: Task): Promise<void>;
  getPlans(): Promise<Plan[]>;
  savePlan(plan: Plan): Promise<void>;
  getSearchLogs(): Promise<SearchLog[]>;
  saveSearchLog(log: SearchLog): Promise<void>;
  getRealUserTestRecords(): Promise<RealUserTestRecord[]>;
  saveRealUserTestRecord(record: RealUserTestRecord): Promise<void>;
  getAchievements(): Promise<AchievementRecord[]>;
  saveAchievement(achievement: AchievementRecord): Promise<void>;
}

const SUPABASE_BLOCKED_MESSAGE = "SupabaseAdapter is blocked until Supabase project URL, anon key, auth session, and Row Level Security policies are provided";

export type StorageMode = "local" | "supabase";

export interface SupabaseAdapterConfig {
  url: string;
  anonKey: string;
  userId?: string;
}

export interface StorageRuntimeStatus {
  mode: StorageMode;
  providerName: string;
  configured: boolean;
  persistence: "browser-local" | "cloud";
  syncEnabled: boolean;
  migrationRequired: boolean;
  message: string;
}

export function getStorageRuntimeStatus(env: Record<string, unknown> = {}): StorageRuntimeStatus {
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === "string" ? env.VITE_SUPABASE_ANON_KEY.trim() : "";
  const configured = Boolean(url && anonKey);

  return {
    mode: configured ? "supabase" : "local",
    providerName: configured ? "Supabase" : "LocalStorage",
    configured,
    persistence: configured ? "cloud" : "browser-local",
    syncEnabled: false,
    migrationRequired: configured,
    message: configured
      ? "Supabase credentials are present, but cloud sync remains blocked until auth, migrations, and RLS are verified."
      : "LocalStorage mode is active. Data stays in the current browser until Supabase is configured and migration is confirmed."
  };
}

export function createLocalStorageAdapter(storage: Storage, appStateKey: string, achievementKey: string): LocalStorageAdapter {
  return new LocalStorageAdapter(storage, appStateKey, achievementKey);
}

export function createSupabaseAdapter(config: SupabaseAdapterConfig): SupabaseAdapter {
  return new SupabaseAdapter(config);
}

export class LocalStorageAdapter implements LegacyEntityStorageAdapter, StorageAdapter {
  readonly kind: StorageKind = "localStorage";
  readonly capabilities: StorageCapabilities = LOCAL_STORAGE_CONTRACT_CAPABILITIES;

  constructor(private readonly storage: Storage, private readonly appStateKey: string, private readonly achievementKey: string) {}

  async open(): Promise<void> {}

  async close(): Promise<void> {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.storage);
  }

  async getSavedItems(): Promise<SavedItem[]> {
    return this.readState().savedItems ?? [];
  }

  async saveSavedItem(item: SavedItem): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, savedItems: upsertById(state.savedItems ?? [], item) });
  }

  async getActionCards(): Promise<ActionCard[]> {
    return this.readState().actionCards ?? [];
  }

  async saveActionCard(card: ActionCard): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, actionCards: upsertById(state.actionCards ?? [], card) });
  }

  async getImportBatches(): Promise<ImportBatch[]> {
    return this.readState().importBatches ?? [];
  }

  async saveImportBatch(batch: ImportBatch): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, importBatches: upsertById(state.importBatches ?? [], batch) });
  }

  async getImportBatchItems(batchId?: string): Promise<ImportBatchItem[]> {
    const items = this.readState().importBatchItems ?? [];
    return batchId ? items.filter((item: ImportBatchItem) => item.batchId === batchId) : items;
  }

  async saveImportBatchItem(item: ImportBatchItem): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, importBatchItems: upsertById(state.importBatchItems ?? [], item) });
  }

  async getSmartAlbums(): Promise<SmartAlbum[]> {
    return this.readState().smartAlbums ?? [];
  }

  async saveSmartAlbum(album: SmartAlbum): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, smartAlbums: upsertById(state.smartAlbums ?? [], album) });
  }

  async getTasks(actionCardId?: string): Promise<Task[]> {
    const cards = this.readState().actionCards ?? [];
    const tasks = cards.flatMap((card: ActionCard) => card.tasks ?? []);
    return actionCardId ? tasks.filter((task: Task) => task.actionCardId === actionCardId) : tasks;
  }

  async saveTask(task: Task): Promise<void> {
    const state = this.readState();
    const cards = (state.actionCards ?? []) as ActionCard[];
    this.writeState({
      ...state,
      actionCards: cards.map((card) =>
        card.id === task.actionCardId ? { ...card, tasks: upsertById(card.tasks ?? [], task), updatedAt: new Date().toISOString() } : card
      )
    });
  }

  async getPlans(): Promise<Plan[]> {
    return this.readState().plans ?? [];
  }

  async savePlan(plan: Plan): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, plans: upsertById(state.plans ?? [], plan) });
  }

  async getSearchLogs(): Promise<SearchLog[]> {
    return this.readState().searchLogs ?? [];
  }

  async saveSearchLog(log: SearchLog): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, searchLogs: upsertById(state.searchLogs ?? [], log) });
  }

  async getRealUserTestRecords(): Promise<RealUserTestRecord[]> {
    return this.readState().realUserTestRecords ?? [];
  }

  async saveRealUserTestRecord(record: RealUserTestRecord): Promise<void> {
    const state = this.readState();
    this.writeState({ ...state, realUserTestRecords: upsertById(state.realUserTestRecords ?? [], record) });
  }

  async getAchievements(): Promise<AchievementRecord[]> {
    return Object.entries(JSON.parse(this.storage.getItem(this.achievementKey) || "{}") as Record<string, string>)
      .map(([id, unlockedAt]) => ({ id, unlockedAt }));
  }

  async saveAchievement(achievement: AchievementRecord): Promise<void> {
    const current = JSON.parse(this.storage.getItem(this.achievementKey) || "{}") as Record<string, string>;
    this.storage.setItem(this.achievementKey, JSON.stringify({ ...current, [achievement.id]: achievement.unlockedAt }));
  }

  async get<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<StorageRecordMap[K] | undefined> {
    throw unsupported(this.kind, "get", store);
  }

  async getAll<K extends StorageEntityName>(store: K, options?: StorageQueryOptions<K>): Promise<StorageRecordMap[K][]> {
    throw unsupported(this.kind, "getAll", store);
  }

  async query<K extends StorageEntityName>(store: K, query: StorageQuery<K>): Promise<StorageRecordMap[K][]> {
    throw unsupported(this.kind, "query", store);
  }

  async put<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): Promise<void> {
    throw unsupported(this.kind, "put", store);
  }

  async bulkPut<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): Promise<StorageBulkWriteResult> {
    throw unsupported(this.kind, "bulkPut", store);
  }

  async delete<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<void> {
    throw unsupported(this.kind, "delete", store);
  }

  async clear<K extends StorageEntityName>(store: K): Promise<void> {
    throw unsupported(this.kind, "clear", store);
  }

  async transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    throw unsupported(this.kind, "transaction");
  }

  async exportSnapshot(options?: StorageSnapshotOptions): Promise<StorageSnapshot> {
    throw unsupported(this.kind, "exportSnapshot");
  }

  async importSnapshot(snapshot: StorageSnapshot, options: StorageImportOptions): Promise<StorageImportResult> {
    throw unsupported(this.kind, "importSnapshot");
  }

  async getSchemaVersion(): Promise<number> {
    const state = this.readState();
    return typeof state.schemaVersion === "number" ? state.schemaVersion : 1;
  }

  async healthCheck(): Promise<StorageHealthReport> {
    const warnings: string[] = [];
    let available = true;
    let schemaVersion: number | undefined;
    try {
      schemaVersion = await this.getSchemaVersion();
    } catch (error) {
      available = false;
      warnings.push("LocalStorageAdapter could not parse the current AppState.");
    }

    return {
      adapter: this.kind,
      available,
      opened: true,
      schemaVersion,
      writable: undefined,
      quotaWarning: undefined,
      capabilities: this.capabilities,
      warnings,
      checkedAt: new Date().toISOString()
    };
  }

  private readState(): Record<string, any> {
    return JSON.parse(this.storage.getItem(this.appStateKey) || "{}") as Record<string, any>;
  }

  private writeState(state: Record<string, any>) {
    this.storage.setItem(this.appStateKey, JSON.stringify(state));
  }
}

export class SupabaseAdapter implements LegacyEntityStorageAdapter, StorageAdapter {
  readonly kind: StorageKind = "supabase";
  readonly capabilities: StorageCapabilities = SUPABASE_BLOCKED_CAPABILITIES;

  constructor(readonly config?: SupabaseAdapterConfig) {}

  async open(): Promise<void> { throw unsupported(this.kind, "open"); }
  async close(): Promise<void> {}
  async isAvailable(): Promise<boolean> { return false; }

  async getSavedItems(): Promise<SavedItem[]> { throwBlockedSupabase(); }
  async saveSavedItem(): Promise<void> { throwBlockedSupabase(); }
  async getActionCards(): Promise<ActionCard[]> { throwBlockedSupabase(); }
  async saveActionCard(): Promise<void> { throwBlockedSupabase(); }
  async getImportBatches(): Promise<ImportBatch[]> { throwBlockedSupabase(); }
  async saveImportBatch(): Promise<void> { throwBlockedSupabase(); }
  async getImportBatchItems(): Promise<ImportBatchItem[]> { throwBlockedSupabase(); }
  async saveImportBatchItem(): Promise<void> { throwBlockedSupabase(); }
  async getSmartAlbums(): Promise<SmartAlbum[]> { throwBlockedSupabase(); }
  async saveSmartAlbum(): Promise<void> { throwBlockedSupabase(); }
  async getTasks(): Promise<Task[]> { throwBlockedSupabase(); }
  async saveTask(): Promise<void> { throwBlockedSupabase(); }
  async getPlans(): Promise<Plan[]> { throwBlockedSupabase(); }
  async savePlan(): Promise<void> { throwBlockedSupabase(); }
  async getSearchLogs(): Promise<SearchLog[]> { throwBlockedSupabase(); }
  async saveSearchLog(): Promise<void> { throwBlockedSupabase(); }
  async getRealUserTestRecords(): Promise<RealUserTestRecord[]> { throwBlockedSupabase(); }
  async saveRealUserTestRecord(): Promise<void> { throwBlockedSupabase(); }
  async getAchievements(): Promise<AchievementRecord[]> { throwBlockedSupabase(); }
  async saveAchievement(): Promise<void> { throwBlockedSupabase(); }

  async get<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<StorageRecordMap[K] | undefined> { throw unsupported(this.kind, "get", store); }
  async getAll<K extends StorageEntityName>(store: K, options?: StorageQueryOptions<K>): Promise<StorageRecordMap[K][]> { throw unsupported(this.kind, "getAll", store); }
  async query<K extends StorageEntityName>(store: K, query: StorageQuery<K>): Promise<StorageRecordMap[K][]> { throw unsupported(this.kind, "query", store); }
  async put<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): Promise<void> { throw unsupported(this.kind, "put", store); }
  async bulkPut<K extends StorageEntityName>(store: K, values: StorageRecordMap[K][]): Promise<StorageBulkWriteResult> { throw unsupported(this.kind, "bulkPut", store); }
  async delete<K extends StorageEntityName>(store: K, id: StoragePrimaryKey): Promise<void> { throw unsupported(this.kind, "delete", store); }
  async clear<K extends StorageEntityName>(store: K): Promise<void> { throw unsupported(this.kind, "clear", store); }
  async transaction<T>(stores: StorageEntityName[], mode: StorageTransactionMode, operation: (tx: StorageTransaction) => Promise<T>): Promise<T> { throw unsupported(this.kind, "transaction"); }
  async exportSnapshot(options?: StorageSnapshotOptions): Promise<StorageSnapshot> { throw unsupported(this.kind, "exportSnapshot"); }
  async importSnapshot(snapshot: StorageSnapshot, options: StorageImportOptions): Promise<StorageImportResult> { throw unsupported(this.kind, "importSnapshot"); }
  async getSchemaVersion(): Promise<number> { throw unsupported(this.kind, "getSchemaVersion"); }
  async healthCheck(): Promise<StorageHealthReport> {
    return {
      adapter: this.kind,
      available: false,
      opened: false,
      capabilities: this.capabilities,
      warnings: ["SupabaseAdapter remains blocked until credentials, auth, migrations, and Row Level Security are verified."],
      checkedAt: new Date().toISOString()
    };
  }
}

function throwBlockedSupabase(): never {
  throw new StorageError({
    adapter: "supabase",
    code: "STORAGE_NOT_SUPPORTED",
    message: SUPABASE_BLOCKED_MESSAGE,
    recoverable: true
  });
}

function unsupported(adapter: StorageKind, operation: string, store?: StorageEntityName): StorageError {
  return createStorageNotSupportedError(adapter, operation, store);
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((entry) => entry.id === item.id);
  if (!exists) return [item, ...items];
  return items.map((entry) => (entry.id === item.id ? item : entry));
}
