import type {
  ActionCard,
  ClassificationCorrection,
  ImportBatch,
  ImportBatchItem,
  PlanCard,
  SavedItem,
  SmartAlbum
} from "@revival/shared-types";
import type { StoredSetting } from "./contracts";

export interface SavedItemRepository {
  findById(id: string): Promise<SavedItem | undefined>;
  findBySourceItemId(sourceItemId: string): Promise<SavedItem | undefined>;
  findByNormalizedUrl(normalizedSourceUrl: string): Promise<SavedItem | undefined>;
  save(item: SavedItem): Promise<void>;
  saveMany(items: SavedItem[]): Promise<void>;
  updateClassification(item: SavedItem): Promise<void>;
  updateUserNote(id: string, userNote: string): Promise<void>;
}

export interface ImportRepository {
  saveBatch(batch: ImportBatch): Promise<void>;
  saveBatchItems(items: ImportBatchItem[]): Promise<void>;
  getBatchWithItems(batchId: string): Promise<{ batch: ImportBatch; items: ImportBatchItem[] } | undefined>;
  findDuplicateItems(normalizedSourceUrl: string): Promise<ImportBatchItem[]>;
}

export interface SmartAlbumRepository {
  getById(id: string): Promise<SmartAlbum | undefined>;
  listByStatus(status: SmartAlbum["status"]): Promise<SmartAlbum[]>;
  save(album: SmartAlbum): Promise<void>;
  addItems(albumId: string, savedItemIds: string[]): Promise<void>;
  removeItems(albumId: string, savedItemIds: string[]): Promise<void>;
}

export interface ActionCardRepository {
  findBySavedItemId(savedItemId: string): Promise<ActionCard | undefined>;
  save(card: ActionCard): Promise<void>;
  complete(cardId: string): Promise<void>;
}

export interface PlanCardRepository {
  listByDate(plannedDate: string): Promise<PlanCard[]>;
  listByStatus(status: PlanCard["status"]): Promise<PlanCard[]>;
  save(card: PlanCard): Promise<void>;
  reschedule(cardId: string, plannedDate: string): Promise<void>;
  cancel(cardId: string): Promise<void>;
  complete(cardId: string): Promise<void>;
}

export interface ClassificationCorrectionRepository {
  listBySavedItemId(savedItemId: string): Promise<ClassificationCorrection[]>;
  save(correction: ClassificationCorrection): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<StoredSetting | undefined>;
  save(setting: StoredSetting): Promise<void>;
  list(category?: StoredSetting["category"]): Promise<StoredSetting[]>;
}
