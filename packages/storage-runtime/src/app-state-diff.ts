import {
  RUNTIME_APP_METADATA_KEY,
  RUNTIME_ORDERED_COLLECTIONS,
  RUNTIME_ORDER_MANIFEST_KEY,
  type StorageRecordMap,
  type StoredSetting
} from "@revival/storage-service";
import {
  RUNTIME_ACHIEVEMENTS_STORAGE_KEY,
  RUNTIME_THEME_STORAGE_KEY
} from "./local-storage-runtime";
import {
  canonicalRuntimeValue,
  dehydrateRuntimeState,
  type RuntimeEntityRecords,
  type RuntimeEntityStoreName,
  type RuntimeStateBundle
} from "./app-state-codec";

export interface RuntimeStoreDiff<K extends RuntimeEntityStoreName = RuntimeEntityStoreName> {
  store: K;
  create: StorageRecordMap[K][];
  update: StorageRecordMap[K][];
  deleteIds: string[];
  unchangedCount: number;
}

export interface RuntimeStateDiff {
  stores: { [K in RuntimeEntityStoreName]: RuntimeStoreDiff<K> };
  metadataChanged: boolean;
  orderManifestChanged: boolean;
  productSettingsChanged: {
    theme: boolean;
    achievements: boolean;
  };
  changedSettings: StoredSetting[];
  changedStoreNames: RuntimeEntityStoreName[];
  isEmpty: boolean;
}

export function createRuntimeStateDiff(
  previous: RuntimeStateBundle,
  next: RuntimeStateBundle,
  operationTimestamp: string
): RuntimeStateDiff {
  const before = dehydrateRuntimeState(previous, operationTimestamp);
  const after = dehydrateRuntimeState(next, operationTimestamp);
  const stores: RuntimeStateDiff["stores"] = {
    savedItems: diffStore("savedItems", before.stores.savedItems, after.stores.savedItems),
    actionCards: diffStore("actionCards", before.stores.actionCards, after.stores.actionCards),
    planCards: diffStore("planCards", before.stores.planCards, after.stores.planCards),
    classificationCorrections: diffStore("classificationCorrections", before.stores.classificationCorrections, after.stores.classificationCorrections),
    searchLogs: diffStore("searchLogs", before.stores.searchLogs, after.stores.searchLogs),
    smartAlbums: diffStore("smartAlbums", before.stores.smartAlbums, after.stores.smartAlbums),
    importBatches: diffStore("importBatches", before.stores.importBatches, after.stores.importBatches),
    importBatchItems: diffStore("importBatchItems", before.stores.importBatchItems, after.stores.importBatchItems)
  };
  const changedStoreNames = RUNTIME_ORDERED_COLLECTIONS.filter((store) => {
    const storeDiff = stores[store];
    return storeDiff.create.length > 0 || storeDiff.update.length > 0 || storeDiff.deleteIds.length > 0;
  });

  const beforeSettings = new Map(before.settings.map((setting) => [setting.key, setting]));
  const afterSettings = new Map(after.settings.map((setting) => [setting.key, setting]));
  const changed = (key: string): boolean => !sameSetting(beforeSettings.get(key), afterSettings.get(key));
  const metadataChanged = changed(RUNTIME_APP_METADATA_KEY);
  const orderManifestChanged = changed(RUNTIME_ORDER_MANIFEST_KEY);
  const productSettingsChanged = {
    theme: changed(RUNTIME_THEME_STORAGE_KEY),
    achievements: changed(RUNTIME_ACHIEVEMENTS_STORAGE_KEY)
  };
  const changedKeys = [
    ...(metadataChanged ? [RUNTIME_APP_METADATA_KEY] : []),
    ...(orderManifestChanged ? [RUNTIME_ORDER_MANIFEST_KEY] : []),
    ...(productSettingsChanged.theme ? [RUNTIME_THEME_STORAGE_KEY] : []),
    ...(productSettingsChanged.achievements ? [RUNTIME_ACHIEVEMENTS_STORAGE_KEY] : [])
  ];
  const changedSettings = changedKeys.map((key) => afterSettings.get(key)!).filter(Boolean);
  return {
    stores,
    metadataChanged,
    orderManifestChanged,
    productSettingsChanged,
    changedSettings,
    changedStoreNames,
    isEmpty: changedStoreNames.length === 0 && changedSettings.length === 0
  };
}

function diffStore<K extends RuntimeEntityStoreName>(
  store: K,
  previous: RuntimeEntityRecords[K],
  next: RuntimeEntityRecords[K]
): RuntimeStoreDiff<K> {
  const before = new Map(previous.map((record) => [record.id, record]));
  const after = new Map(next.map((record) => [record.id, record]));
  const create: StorageRecordMap[K][] = [];
  const update: StorageRecordMap[K][] = [];
  let unchangedCount = 0;
  for (const record of next) {
    const old = before.get(record.id);
    if (!old) create.push(record as unknown as StorageRecordMap[K]);
    else if (canonicalRuntimeValue(old) !== canonicalRuntimeValue(record)) update.push(record as unknown as StorageRecordMap[K]);
    else unchangedCount += 1;
  }
  const deleteIds = previous.filter((record) => !after.has(record.id)).map((record) => record.id);
  return { store, create, update, deleteIds, unchangedCount };
}

function sameSetting(left: StoredSetting | undefined, right: StoredSetting | undefined): boolean {
  if (!left || !right) return left === right;
  return canonicalRuntimeValue({
    key: left.key,
    value: left.value,
    category: left.category,
    internal: left.internal,
    schemaVersion: left.schemaVersion
  }) === canonicalRuntimeValue({
    key: right.key,
    value: right.value,
    category: right.category,
    internal: right.internal,
    schemaVersion: right.schemaVersion
  });
}
