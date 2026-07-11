import { generateSmartAlbums } from "@revival/action-card-service";
import { createMockAiProvider, isAiProviderPromise, type AiProvider } from "@revival/ai-service";
import { createImportedRecords } from "@revival/database";
import type {
  ActionCard,
  ExtensionScannedItem,
  ImportBatch,
  ImportBatchItem,
  ImportSource,
  SavedItem,
  ShareInput,
  SmartAlbum
} from "@revival/shared-types";

export interface ImportInputItem {
  sourceUrl?: string;
  title?: string;
  rawShareText?: string;
  visibleText?: string;
  coverUrl?: string;
  userNote?: string;
}

export interface ProcessImportBatchInput {
  source: ImportSource;
  title: string;
  items: ImportInputItem[];
  userId: string;
  existingSavedItems: SavedItem[];
  existingActionCards: ActionCard[];
  existingSmartAlbums?: SmartAlbum[];
  aiProvider?: AiProvider;
  now?: Date;
}

export interface ProcessImportBatchResult {
  batch: ImportBatch;
  batchItems: ImportBatchItem[];
  importedSavedItems: SavedItem[];
  actionCards: ActionCard[];
  duplicates: ImportBatchItem[];
  failedItems: ImportBatchItem[];
  smartAlbumCandidates: SmartAlbum[];
}

export function processImportBatch(input: ProcessImportBatchInput): ProcessImportBatchResult {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const batchId = createId("batch");
  const aiProvider = input.aiProvider ?? createMockAiProvider({ generateSmartAlbums });
  const existingKeys = new Map<string, SavedItem>();
  input.existingSavedItems.forEach((item) => {
    const key = getSavedItemDedupeKey(item);
    if (key) existingKeys.set(key, item);
  });

  const batchItems: ImportBatchItem[] = [];
  const importedSavedItems: SavedItem[] = [];
  const actionCards: ActionCard[] = [];
  const duplicates: ImportBatchItem[] = [];
  const failedItems: ImportBatchItem[] = [];

  input.items.forEach((rawItem, index) => {
    const normalized = normalizeImportItem(rawItem);
    const itemId = createId("batch_item");
    const baseItem: ImportBatchItem = {
      id: itemId,
      batchId,
      sourceUrl: normalized.sourceUrl,
      title: normalized.title,
      rawShareText: normalized.rawShareText,
      visibleText: normalized.visibleText,
      coverUrl: normalized.coverUrl,
      userNote: normalized.userNote,
      status: "pending",
      createdAt
    };

    if (!normalized.sourceUrl) {
      const failed: ImportBatchItem = {
        ...baseItem,
        status: "failed",
        errorMessage: "缺少 sourceUrl，第一版旧收藏扫描要求至少有原帖链接"
      };
      batchItems.push(failed);
      failedItems.push(failed);
      return;
    }

    const key = getShareInputDedupeKey(normalized);
    const duplicate = key ? existingKeys.get(key) : undefined;
    if (duplicate) {
      const duplicateItem: ImportBatchItem = {
        ...baseItem,
        status: "duplicate",
        duplicateOfSavedItemId: duplicate.id
      };
      batchItems.push(duplicateItem);
      duplicates.push(duplicateItem);
      return;
    }

    try {
      const itemDate = new Date(now.getTime() + index);
      const classification = aiProvider.classifyAndGenerateActionCard(normalized);
      if (isAiProviderPromise(classification)) {
        throw new Error("Async AI providers require an async import pipeline; mock fallback remains the default for the current Web MVP.");
      }
      const records = createImportedRecords(input.userId, normalized, classification, itemDate);
      existingKeys.set(key, records.savedItem);
      importedSavedItems.push(records.savedItem);
      actionCards.push(records.actionCard);
      batchItems.push({
        ...baseItem,
        status: "imported",
        createdSavedItemId: records.savedItem.id,
        createdActionCardId: records.actionCard.id
      });
    } catch (error) {
      const failed: ImportBatchItem = {
        ...baseItem,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "导入失败"
      };
      batchItems.push(failed);
      failedItems.push(failed);
    }
  });

  const allSavedItems = [...importedSavedItems, ...input.existingSavedItems];
  const generatedAlbums = aiProvider.generateSmartAlbums({ savedItems: allSavedItems, existingAlbums: input.existingSmartAlbums ?? [], now });
  if (isAiProviderPromise(generatedAlbums)) {
    throw new Error("Async AI album generation requires an async import pipeline; mock fallback remains the default for the current Web MVP.");
  }
  const smartAlbumCandidates = mergeSmartAlbumCandidates(input.existingSmartAlbums ?? [], generatedAlbums);
  const createdAlbumCount = smartAlbumCandidates.filter((album) => album.status === "candidate").length;
  const status = pickBatchStatus(importedSavedItems.length, duplicates.length, failedItems.length, input.items.length);

  const batch: ImportBatch = {
    id: batchId,
    source: input.source,
    title: input.title,
    status,
    rawCount: input.items.length,
    importedCount: importedSavedItems.length,
    duplicateCount: duplicates.length,
    failedCount: failedItems.length,
    createdActionCardCount: actionCards.length,
    createdAlbumCount,
    errorMessage: failedItems[0]?.errorMessage,
    createdAt,
    updatedAt: new Date(now.getTime() + Math.max(1, input.items.length)).toISOString()
  };

  return {
    batch,
    batchItems,
    importedSavedItems,
    actionCards,
    duplicates,
    failedItems,
    smartAlbumCandidates
  };
}

export function extensionItemsToImportItems(items: ExtensionScannedItem[]): ImportInputItem[] {
  return items.map((item) => ({
    sourceUrl: item.sourceUrl,
    title: item.title,
    rawShareText: item.visibleText || item.title,
    visibleText: item.visibleText,
    coverUrl: item.coverUrl,
    userNote: "来自浏览器扩展旧收藏夹扫描，用户确认后导入。"
  }));
}

export function normalizeImportItem(item: ImportInputItem): ShareInput & Pick<ImportInputItem, "visibleText" | "coverUrl"> {
  const sourceUrl = normalizeUrl(item.sourceUrl ?? "");
  const visibleText = cleanText(item.visibleText ?? "").slice(0, 320);
  const rawShareText = cleanText(item.rawShareText ?? visibleText);
  const fallbackTitle = rawShareText || visibleText || sourceUrl || "未命名收藏";

  return {
    sourceUrl,
    title: cleanText(item.title ?? "") || fallbackTitle.slice(0, 40),
    rawShareText,
    visibleText: visibleText || undefined,
    coverUrl: normalizeUrl(item.coverUrl ?? "") || undefined,
    userNote: cleanText(item.userNote ?? "")
  };
}

function mergeSmartAlbumCandidates(existingAlbums: SmartAlbum[], generatedAlbums: SmartAlbum[]): SmartAlbum[] {
  const byId = new Map(existingAlbums.map((album) => [album.id, album]));
  generatedAlbums.forEach((album) => {
    const existing = byId.get(album.id);
    if (!existing) {
      byId.set(album.id, album);
      return;
    }

    byId.set(album.id, {
      ...album,
      title: existing.title,
      description: existing.description || album.description,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: album.updatedAt
    });
  });

  return [...byId.values()].sort((a, b) => b.priority - a.priority || b.savedItemIds.length - a.savedItemIds.length);
}

function pickBatchStatus(importedCount: number, duplicateCount: number, failedCount: number, rawCount: number): ImportBatch["status"] {
  if (rawCount === 0) return "failed";
  if (failedCount === rawCount) return "failed";
  if (failedCount > 0 || duplicateCount > 0) return importedCount > 0 ? "partially_completed" : "failed";
  return "completed";
}

function normalizeUrl(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const url = new URL(clean);
    url.hash = "";
    return url.toString();
  } catch {
    return clean;
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getSavedItemDedupeKey(item: SavedItem): string {
  return item.sourceUrl.trim().toLowerCase() || item.title.trim().toLowerCase();
}

function getShareInputDedupeKey(input: ShareInput): string {
  return input.sourceUrl.trim().toLowerCase() || input.title.trim().toLowerCase();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}