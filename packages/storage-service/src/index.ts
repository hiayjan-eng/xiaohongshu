import type { ActionCard, ImportBatch, ImportBatchItem, SavedItem, SmartAlbum } from "@revival/shared-types";

export interface AchievementRecord {
  id: string;
  unlockedAt: string;
}

export interface StorageAdapter {
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
  getAchievements(): Promise<AchievementRecord[]>;
  saveAchievement(achievement: AchievementRecord): Promise<void>;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly storage: Storage, private readonly appStateKey: string, private readonly achievementKey: string) {}

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

  async getAchievements(): Promise<AchievementRecord[]> {
    return Object.entries(JSON.parse(this.storage.getItem(this.achievementKey) || "{}") as Record<string, string>)
      .map(([id, unlockedAt]) => ({ id, unlockedAt }));
  }

  async saveAchievement(achievement: AchievementRecord): Promise<void> {
    const current = JSON.parse(this.storage.getItem(this.achievementKey) || "{}") as Record<string, string>;
    this.storage.setItem(this.achievementKey, JSON.stringify({ ...current, [achievement.id]: achievement.unlockedAt }));
  }

  private readState(): Record<string, any> {
    return JSON.parse(this.storage.getItem(this.appStateKey) || "{}") as Record<string, any>;
  }

  private writeState(state: Record<string, any>) {
    this.storage.setItem(this.appStateKey, JSON.stringify(state));
  }
}

export class SupabaseAdapter implements StorageAdapter {
  async getSavedItems(): Promise<SavedItem[]> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async saveSavedItem(): Promise<void> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async getActionCards(): Promise<ActionCard[]> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async saveActionCard(): Promise<void> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async getImportBatches(): Promise<ImportBatch[]> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async saveImportBatch(): Promise<void> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async getImportBatchItems(): Promise<ImportBatchItem[]> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async saveImportBatchItem(): Promise<void> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async getSmartAlbums(): Promise<SmartAlbum[]> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async saveSmartAlbum(): Promise<void> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async getAchievements(): Promise<AchievementRecord[]> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
  async saveAchievement(): Promise<void> { throw new Error("SupabaseAdapter is a roadmap placeholder"); }
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((entry) => entry.id === item.id);
  if (!exists) return [item, ...items];
  return items.map((entry) => (entry.id === item.id ? item : entry));
}