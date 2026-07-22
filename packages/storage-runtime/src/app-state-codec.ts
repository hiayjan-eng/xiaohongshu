import { APP_SCHEMA_VERSION, type AppState } from "@revival/shared-types";
import {
  RUNTIME_APP_METADATA_KEY,
  RUNTIME_COLLECTION_STORE_MAP,
  RUNTIME_ORDERED_COLLECTIONS,
  RUNTIME_ORDER_MANIFEST_KEY,
  canonicalJsonStringify,
  createRuntimeMetadataSettings,
  parseRuntimeAppMetadata,
  parseRuntimeOrderManifest,
  type RuntimeOrderedCollection,
  type StorageRecordMap,
  type StorageSnapshot,
  type StoredSetting
} from "@revival/storage-service";
import {
  DEFAULT_RUNTIME_THEME_ID,
  RUNTIME_ACHIEVEMENTS_STORAGE_KEY,
  RUNTIME_THEME_STORAGE_KEY
} from "./local-storage-runtime";
import type { StorageRuntimeProductSettings, StorageRuntimeWarning } from "./contracts";
import { StorageRuntimeError, type StorageRuntimeErrorCode } from "./errors";

export type RuntimeEntityStoreName = RuntimeOrderedCollection;

export interface RuntimeEntityRecords {
  savedItems: StorageRecordMap["savedItems"][];
  actionCards: StorageRecordMap["actionCards"][];
  planCards: StorageRecordMap["planCards"][];
  classificationCorrections: StorageRecordMap["classificationCorrections"][];
  searchLogs: StorageRecordMap["searchLogs"][];
  smartAlbums: StorageRecordMap["smartAlbums"][];
  importBatches: StorageRecordMap["importBatches"][];
  importBatchItems: StorageRecordMap["importBatchItems"][];
}

export interface RuntimeStateBundle {
  state: AppState;
  settings: StorageRuntimeProductSettings;
}

export interface DehydratedRuntimeState {
  stores: RuntimeEntityRecords;
  settings: StoredSetting[];
}

export interface HydratedRuntimeState extends RuntimeStateBundle {
  warnings: StorageRuntimeWarning[];
}

export interface RuntimeReferenceIssue {
  store: RuntimeEntityStoreName;
  recordId: string;
  field: string;
}

export function dehydrateRuntimeState(
  bundle: RuntimeStateBundle,
  updatedAt: string
): DehydratedRuntimeState {
  validateAppState(bundle.state, "RUNTIME_DEHYDRATION_FAILED");
  validateProductSettings(bundle.settings, "RUNTIME_DEHYDRATION_FAILED");
  const stores: RuntimeEntityRecords = {
    savedItems: cloneForStorage(bundle.state.savedItems),
    actionCards: cloneForStorage(bundle.state.actionCards),
    planCards: cloneForStorage(bundle.state.planCards ?? []),
    classificationCorrections: cloneForStorage(bundle.state.classificationCorrections ?? []),
    searchLogs: cloneForStorage(bundle.state.searchLogs),
    smartAlbums: cloneForStorage(bundle.state.smartAlbums ?? []),
    importBatches: cloneForStorage(bundle.state.importBatches ?? []),
    importBatchItems: cloneForStorage(bundle.state.importBatchItems ?? [])
  };
  return {
    stores,
    settings: makeRuntimeSettings(bundle, updatedAt)
  };
}

export function dehydrateRuntimeSettings(
  bundle: RuntimeStateBundle,
  updatedAt: string
): StoredSetting[] {
  validateAppState(bundle.state, "RUNTIME_DEHYDRATION_FAILED");
  validateProductSettings(bundle.settings, "RUNTIME_DEHYDRATION_FAILED");
  return makeRuntimeSettings(bundle, updatedAt);
}

export function hydrateRuntimeState(input: DehydratedRuntimeState): HydratedRuntimeState {
  const settingMap = new Map(input.settings.map((setting) => [setting.key, setting]));
  const metadataResult = parseRuntimeAppMetadata(settingMap.get(RUNTIME_APP_METADATA_KEY));
  if (!metadataResult.valid) {
    throw codecError(metadataResult.reason === "missing" ? "RUNTIME_METADATA_MISSING" : "RUNTIME_METADATA_UNSUPPORTED");
  }
  const manifestResult = parseRuntimeOrderManifest(settingMap.get(RUNTIME_ORDER_MANIFEST_KEY));
  if (!manifestResult.valid) {
    throw codecError(manifestResult.reason === "missing" ? "RUNTIME_ORDER_MANIFEST_MISSING" : "RUNTIME_ORDER_MANIFEST_INVALID");
  }
  const metadata = metadataResult.value;
  const manifest = manifestResult.value;
  if (!metadata || !manifest) throw codecError("RUNTIME_METADATA_UNSUPPORTED");
  if (metadata.appSchemaVersion !== APP_SCHEMA_VERSION) {
    throw codecError("RUNTIME_TARGET_SCHEMA_MISMATCH");
  }

  const ordered: RuntimeEntityRecords = {
    savedItems: orderRecords(input.stores.savedItems, manifest.orders.savedItems),
    actionCards: orderRecords(input.stores.actionCards, manifest.orders.actionCards),
    planCards: orderRecords(input.stores.planCards, manifest.orders.planCards),
    classificationCorrections: orderRecords(input.stores.classificationCorrections, manifest.orders.classificationCorrections),
    searchLogs: orderRecords(input.stores.searchLogs, manifest.orders.searchLogs),
    smartAlbums: orderRecords(input.stores.smartAlbums, manifest.orders.smartAlbums),
    importBatches: orderRecords(input.stores.importBatches, manifest.orders.importBatches),
    importBatchItems: orderRecords(input.stores.importBatchItems, manifest.orders.importBatchItems)
  };
  const state: AppState = {
    schemaVersion: metadata.appSchemaVersion,
    user: clone(metadata.user),
    savedItems: ordered.savedItems,
    actionCards: ordered.actionCards,
    planCards: ordered.planCards,
    classificationCorrections: ordered.classificationCorrections,
    searchLogs: ordered.searchLogs,
    smartAlbums: ordered.smartAlbums,
    importBatches: ordered.importBatches,
    importBatchItems: ordered.importBatchItems
  };
  validateAppState(state, "RUNTIME_HYDRATION_FAILED");

  const warnings: StorageRuntimeWarning[] = [];
  const theme = settingMap.get(RUNTIME_THEME_STORAGE_KEY)?.value;
  const achievements = settingMap.get(RUNTIME_ACHIEVEMENTS_STORAGE_KEY)?.value;
  const settings: StorageRuntimeProductSettings = {
    themeId: typeof theme === "string" && theme.length > 0
      ? theme
      : warnDefaultTheme(warnings),
    achievements: isStringRecord(achievements)
      ? clone(achievements)
      : warnDefaultAchievements(warnings)
  };
  return { state, settings, warnings };
}

export function hydrateRuntimeSnapshot(snapshot: StorageSnapshot): HydratedRuntimeState {
  const records = snapshot.records;
  return hydrateRuntimeState({
    stores: {
      savedItems: clone(records.savedItems ?? []),
      actionCards: clone(records.actionCards ?? []),
      planCards: clone(records.planCards ?? []),
      classificationCorrections: clone(records.classificationCorrections ?? []),
      searchLogs: clone(records.searchLogs ?? []),
      smartAlbums: clone(records.smartAlbums ?? []),
      importBatches: clone(records.importBatches ?? []),
      importBatchItems: clone(records.importBatchItems ?? [])
    },
    settings: clone(records.settings ?? [])
  });
}
export function validateAppState(
  state: AppState,
  errorCode: StorageRuntimeErrorCode = "RUNTIME_ENTITY_REFERENCE_BROKEN"
): void {
  if (!state || !isValidUser(state.user) || (state.schemaVersion ?? APP_SCHEMA_VERSION) !== APP_SCHEMA_VERSION) {
    throw codecError(errorCode);
  }
  for (const collection of RUNTIME_ORDERED_COLLECTIONS) {
    const records = state[collection] ?? [];
    if (!Array.isArray(records) || records.some((record) => !record || typeof record.id !== "string" || record.id.length === 0)) {
      throw codecError(errorCode);
    }
    if (new Set(records.map((record) => record.id)).size !== records.length) throw codecError(errorCode);
  }
  if (findRuntimeReferenceIssues(state).length > 0) throw codecError("RUNTIME_ENTITY_REFERENCE_BROKEN");
}

export function findRuntimeReferenceIssues(state: AppState): RuntimeReferenceIssue[] {
  const savedIds = new Set(state.savedItems.map((record) => record.id));
  const actionIds = new Set(state.actionCards.map((record) => record.id));
  const batchIds = new Set((state.importBatches ?? []).map((record) => record.id));
  const issues: RuntimeReferenceIssue[] = [];
  const add = (store: RuntimeEntityStoreName, recordId: string, field: string): void => {
    issues.push({ store, recordId, field });
  };
  for (const item of state.importBatchItems ?? []) {
    if (!batchIds.has(item.batchId)) add("importBatchItems", item.id, "batchId");
    if (item.createdSavedItemId && !savedIds.has(item.createdSavedItemId)) add("importBatchItems", item.id, "createdSavedItemId");
  }
  for (const card of state.actionCards) {
    if (!savedIds.has(card.savedItemId)) add("actionCards", card.id, "savedItemId");
  }
  for (const card of state.planCards ?? []) {
    if (!savedIds.has(card.savedItemId)) add("planCards", card.id, "savedItemId");
    if (!actionIds.has(card.actionCardId)) add("planCards", card.id, "actionCardId");
  }
  for (const correction of state.classificationCorrections ?? []) {
    if (!savedIds.has(correction.savedItemId)) add("classificationCorrections", correction.id, "savedItemId");
  }
  for (const album of state.smartAlbums ?? []) {
    const fields: Array<[string, string[]]> = [
      ["savedItemIds", album.savedItemIds],
      ["recommendedItemIds", album.recommendedItemIds],
      ["suggestedItemIds", album.suggestedItemIds ?? []],
      ["manuallyAddedItemIds", album.manuallyAddedItemIds ?? []],
      ["manuallyRemovedItemIds", album.manuallyRemovedItemIds ?? []]
    ];
    for (const [field, ids] of fields) {
      if (ids.some((id) => !savedIds.has(id))) add("smartAlbums", album.id, field);
    }
    if (album.coverItemId && !savedIds.has(album.coverItemId)) add("smartAlbums", album.id, "coverItemId");
  }
  return issues;
}

export function canonicalRuntimeValue(value: unknown): string {
  return canonicalJsonStringify(value, { adapter: "indexedDB", code: "STORAGE_VALIDATION_FAILED" });
}

export function cloneRuntimeStorageValue<T>(value: T): T {
  return JSON.parse(canonicalRuntimeValue(value)) as T;
}

function cloneForStorage<T>(value: T): T {
  return cloneRuntimeStorageValue(value);
}

function makeRuntimeSettings(bundle: RuntimeStateBundle, updatedAt: string): StoredSetting[] {
  return [
    ...createRuntimeMetadataSettings(bundle.state, updatedAt),
    makeProductSetting(RUNTIME_THEME_STORAGE_KEY, bundle.settings.themeId, "appearance", updatedAt),
    makeProductSetting(RUNTIME_ACHIEVEMENTS_STORAGE_KEY, bundle.settings.achievements, "product", updatedAt)
  ];
}

function orderRecords<T extends { id: string }>(records: T[], ids: string[]): T[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length || ids.length !== records.length || ids.some((id) => !byId.has(id))) {
    throw codecError("RUNTIME_ORDER_MANIFEST_INVALID");
  }
  return ids.map((id) => clone(byId.get(id)!));
}
function makeProductSetting(
  key: string,
  value: StoredSetting["value"],
  category: StoredSetting["category"],
  updatedAt: string
): StoredSetting {
  return { id: `setting-${key}`, key, value: clone(value), category, internal: false, updatedAt, schemaVersion: 1 };
}

function validateProductSettings(settings: StorageRuntimeProductSettings, code: StorageRuntimeErrorCode): void {
  if (!settings || typeof settings.themeId !== "string" || settings.themeId.length === 0 || !isStringRecord(settings.achievements)) {
    throw codecError(code);
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

function isValidUser(value: unknown): value is AppState["user"] {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return ["id", "name", "email", "createdAt"].every((key) => typeof user[key] === "string" && user[key].length > 0) &&
    !Number.isNaN(Date.parse(String(user.createdAt)));
}

function warnDefaultTheme(warnings: StorageRuntimeWarning[]): string {
  warnings.push({ code: "RUNTIME_SETTING_INVALID", blocking: false, setting: "theme" });
  return DEFAULT_RUNTIME_THEME_ID;
}

function warnDefaultAchievements(warnings: StorageRuntimeWarning[]): Record<string, string> {
  warnings.push({ code: "RUNTIME_SETTING_INVALID", blocking: false, setting: "achievements" });
  return {};
}

function codecError(code: StorageRuntimeErrorCode): StorageRuntimeError {
  return new StorageRuntimeError({ code, runtimeKind: "indexedDB", lifecycle: "loading", recoverable: true });
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}
