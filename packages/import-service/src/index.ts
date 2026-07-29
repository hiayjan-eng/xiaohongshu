import { generateSmartAlbums } from "@revival/action-card-service";
import { createMockAiProvider, isAiProviderPromise, type AiProvider } from "@revival/ai-service";
import { analyzeSourceUrl, buildStableDedupeKey, createSavedItemRecord } from "@revival/database";
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
  canonicalSourceUrl?: string;
  sourceId?: string;
  sourceUrlStatus?: ShareInput["sourceUrlStatus"];
  lastUrlCheckedAt?: string;
  title?: string;
  rawShareText?: string;
  rawText?: string;
  visibleText?: string;
  coverUrl?: string;
  author?: string;
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
  scanSummary?: ImportBatch["scanSummary"];
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
  const existingKeys = new Map<string, { item: SavedItem; origin: "existing_library" | "batch" }>();
  input.existingSavedItems.forEach((item) => {
    const key = getSavedItemDedupeKey(item);
    if (key) existingKeys.set(key, { item, origin: "existing_library" });
  });

  const batchItems: ImportBatchItem[] = [];
  const importedSavedItems: SavedItem[] = [];
  const actionCards: ActionCard[] = [];
  const duplicates: ImportBatchItem[] = [];
  const failedItems: ImportBatchItem[] = [];
  let batchDuplicates = 0;
  let existingLibraryDuplicates = 0;
  let unresolvedDuplicates = 0;

  input.items.forEach((rawItem, index) => {
    const normalized = normalizeImportItem(rawItem);
    const itemId = createId("batch_item");
    const baseItem: ImportBatchItem = {
      id: itemId,
      batchId,
      sourceUrl: normalized.sourceUrl,
      canonicalSourceUrl: normalized.canonicalSourceUrl,
      sourceId: normalized.sourceId,
      sourceUrlStatus: normalized.sourceUrlStatus,
      title: normalized.title,
      rawShareText: normalized.rawShareText,
      visibleText: normalized.visibleText,
      coverUrl: normalized.coverUrl,
      userNote: normalized.userNote,
      status: "pending",
      createdAt
    };

    if (!hasImportableContent(normalized)) {
      const failed: ImportBatchItem = {
        ...baseItem,
        status: "failed",
        errorMessage: "这段内容信息太少，建议补充标题或备注后再生成。"
      };
      batchItems.push(failed);
      failedItems.push(failed);
      return;
    }

    const key = getShareInputDedupeKey(normalized);
    const duplicate = key ? existingKeys.get(key) : undefined;
    if (!key) unresolvedDuplicates += 1;
    if (duplicate) {
      if (duplicate.origin === "batch") batchDuplicates += 1;
      else existingLibraryDuplicates += 1;
      const duplicateItem: ImportBatchItem = {
        ...baseItem,
        status: "duplicate",
        duplicateOfSavedItemId: duplicate.item.id,
        duplicateKind: duplicate.origin
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
      const savedItem = createSavedItemRecord(input.userId, normalized, classification, itemDate);
      if (key) existingKeys.set(key, { item: savedItem, origin: "batch" });
      importedSavedItems.push(savedItem);
      batchItems.push({
        ...baseItem,
        status: "imported",
        createdSavedItemId: savedItem.id
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
    createdActionCardCount: 0,
    createdAlbumCount,
    errorMessage: failedItems[0]?.errorMessage,
    duplicateBreakdown: {
      batchDuplicates,
      existingLibraryDuplicates,
      unresolvedDuplicates
    },
    scanSummary: input.scanSummary,
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

export async function processImportBatchAsync(input: ProcessImportBatchInput): Promise<ProcessImportBatchResult> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const batchId = createId("batch");
  const aiProvider = input.aiProvider ?? createMockAiProvider({ generateSmartAlbums });
  const existingKeys = new Map<string, { item: SavedItem; origin: "existing_library" | "batch" }>();
  input.existingSavedItems.forEach((item) => {
    const key = getSavedItemDedupeKey(item);
    if (key) existingKeys.set(key, { item, origin: "existing_library" });
  });

  const batchItems: ImportBatchItem[] = [];
  const importedSavedItems: SavedItem[] = [];
  const actionCards: ActionCard[] = [];
  const duplicates: ImportBatchItem[] = [];
  const failedItems: ImportBatchItem[] = [];
  let batchDuplicates = 0;
  let existingLibraryDuplicates = 0;
  let unresolvedDuplicates = 0;

  for (const [index, rawItem] of input.items.entries()) {
    const normalized = normalizeImportItem(rawItem);
    const itemId = createId("batch_item");
    const baseItem: ImportBatchItem = {
      id: itemId,
      batchId,
      sourceUrl: normalized.sourceUrl,
      canonicalSourceUrl: normalized.canonicalSourceUrl,
      sourceId: normalized.sourceId,
      sourceUrlStatus: normalized.sourceUrlStatus,
      title: normalized.title,
      rawShareText: normalized.rawShareText,
      visibleText: normalized.visibleText,
      coverUrl: normalized.coverUrl,
      userNote: normalized.userNote,
      status: "pending",
      createdAt
    };

    if (!hasImportableContent(normalized)) {
      const failed: ImportBatchItem = {
        ...baseItem,
        status: "failed",
        errorMessage: "这段内容信息太少，建议补充标题或备注后再生成。"
      };
      batchItems.push(failed);
      failedItems.push(failed);
      continue;
    }

    const key = getShareInputDedupeKey(normalized);
    const duplicate = key ? existingKeys.get(key) : undefined;
    if (!key) unresolvedDuplicates += 1;
    if (duplicate) {
      if (duplicate.origin === "batch") batchDuplicates += 1;
      else existingLibraryDuplicates += 1;
      const duplicateItem: ImportBatchItem = {
        ...baseItem,
        status: "duplicate",
        duplicateOfSavedItemId: duplicate.item.id,
        duplicateKind: duplicate.origin
      };
      batchItems.push(duplicateItem);
      duplicates.push(duplicateItem);
      continue;
    }

    try {
      const itemDate = new Date(now.getTime() + index);
      const classification = await Promise.resolve(aiProvider.classifyAndGenerateActionCard(normalized));
      const savedItem = createSavedItemRecord(input.userId, normalized, classification, itemDate);
      if (key) existingKeys.set(key, { item: savedItem, origin: "batch" });
      importedSavedItems.push(savedItem);
      batchItems.push({
        ...baseItem,
        status: "imported",
        createdSavedItemId: savedItem.id
      });
    } catch (error) {
      const failed: ImportBatchItem = {
        ...baseItem,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Import failed"
      };
      batchItems.push(failed);
      failedItems.push(failed);
    }
  }

  const allSavedItems = [...importedSavedItems, ...input.existingSavedItems];
  const generatedAlbums = await Promise.resolve(aiProvider.generateSmartAlbums({ savedItems: allSavedItems, existingAlbums: input.existingSmartAlbums ?? [], now }));
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
    createdActionCardCount: 0,
    createdAlbumCount,
    errorMessage: failedItems[0]?.errorMessage,
    duplicateBreakdown: {
      batchDuplicates,
      existingLibraryDuplicates,
      unresolvedDuplicates
    },
    scanSummary: input.scanSummary,
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
    canonicalSourceUrl: item.canonicalSourceUrl,
    sourceId: item.sourceId,
    sourceUrlStatus: item.sourceUrlStatus,
    lastUrlCheckedAt: item.lastUrlCheckedAt,
    title: item.title,
    rawShareText: item.visibleText || item.title,
    rawText: item.rawText || item.visibleText || item.title,
    visibleText: item.visibleText,
    coverUrl: item.coverUrl,
    author: item.author,
    userNote: "来自浏览器扩展旧收藏夹扫描，用户确认后导入；先生成收藏索引，不自动生成行动卡。"
  }));
}

export function parseShareInput(item: ImportInputItem): ShareInput & Pick<ImportInputItem, "visibleText" | "coverUrl"> {
  const sourceField = cleanText(item.sourceUrl ?? "");
  const titleField = cleanText(item.title ?? "");
  const rawField = cleanText(item.rawShareText ?? "");
  const visibleText = cleanText(item.visibleText ?? "").slice(0, 320);
  const userNote = cleanText(item.userNote ?? "");
  const sourceParse = splitUrlFromText(sourceField);
  const rawParse = splitUrlFromText(rawField);
  const visibleParse = splitUrlFromText(visibleText);
  const sourceUrl = preserveRawHttpUrl(sourceParse.url || rawParse.url || visibleParse.url || "");
  const source = analyzeSourceUrl(sourceUrl);
  const textParts = [sourceParse.text, rawParse.text, visibleParse.text]
    .map(cleanText)
    .filter(Boolean);
  const rawShareText = uniqueTextParts(textParts).join(" ");
  const fallbackText = rawShareText || userNote || sourceUrl;
  const title = titleField || extractShareTitle(fallbackText) || (fallbackText ? fallbackText.slice(0, 40) : "待整理收藏");

  return {
    sourceUrl,
    canonicalSourceUrl: item.canonicalSourceUrl || source.canonicalSourceUrl,
    sourceId: item.sourceId || source.sourceId,
    sourceUrlStatus: item.sourceUrlStatus || source.status,
    lastUrlCheckedAt: item.lastUrlCheckedAt || new Date().toISOString(),
    title,
    rawShareText,
    rawText: cleanText(item.rawText ?? rawShareText),
    author: cleanText(item.author ?? "") || undefined,
    visibleText: visibleText || undefined,
    coverUrl: normalizeUrl(item.coverUrl ?? "") || undefined,
    userNote
  };
}

export function normalizeImportItem(item: ImportInputItem): ShareInput & Pick<ImportInputItem, "visibleText" | "coverUrl"> {
  return parseShareInput(item);
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

  return [...byId.values()].sort((a, b) => b.priorityScore - a.priorityScore || b.savedItemIds.length - a.savedItemIds.length);
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
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function preserveRawHttpUrl(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const url = new URL(clean);
    return ["http:", "https:"].includes(url.protocol) ? clean : "";
  } catch {
    return "";
  }
}

function splitUrlFromText(value: string): { url: string; text: string } {
  const urlMatch = value.match(/https?:\/\/[^\s，。；;）)】]+/i);
  if (!urlMatch) return { url: "", text: value };
  const url = trimUrl(urlMatch[0]);
  const text = cleanText(value.replace(urlMatch[0], " "));
  return { url, text };
}

function extractShareTitle(value: string): string {
  const clean = cleanText(value.replace(/复制打开小红书|小红书\s*-\s*你的生活兴趣社区|小红书|你的生活兴趣社区/g, " "));
  const bracket = clean.match(/[【\[]([^】\]]+)[】\]]/);
  let candidate = bracket?.[1] ?? clean;
  if (!bracket) candidate = candidate.replace(/^\d+\s*/, "");
  candidate = candidate.trim();
  const beforePlatform = candidate.split(/[｜|]/)[0] ?? candidate;
  const withoutAuthor = beforePlatform.replace(/\s+[-—–]\s+[^-—–]+$/, "");
  const title = cleanText(withoutAuthor || beforePlatform || candidate).replace(/😆/g, "").trim();
  return title.slice(0, 48);
}

function hasImportableContent(input: ShareInput): boolean {
  return Boolean([input.sourceUrl, input.title, input.rawShareText, input.userNote].some((value) => value.trim()));
}

function uniqueTextParts(parts: string[]): string[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimUrl(value: string): string {
  return value.replace(/[，。；;）)】]+$/g, "");
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function getSavedItemDedupeKey(item: SavedItem): string {
  return buildStableDedupeKey(item);
}

function getShareInputDedupeKey(input: ShareInput): string {
  return buildStableDedupeKey(input);
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}