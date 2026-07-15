import type { AppState } from "@revival/shared-types";
import {
  LEGACY_ACHIEVEMENT_STORAGE_KEY,
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_DEVELOPER_MODE_STORAGE_KEY,
  LEGACY_QA_WRITE_TEST_STORAGE_KEY,
  LEGACY_REAL_USER_TEST_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  type ReadonlyStorageLike
} from "../src/index";
import {
  FIXTURE_DATES,
  makeActionCard,
  makeClassificationCorrection,
  makeImportBatch,
  makeImportBatchItem,
  makePlanCard,
  makeSavedItem,
  makeSearchLog,
  makeSmartAlbum
} from "./fixtures";

export class FakeReadonlyStorage implements ReadonlyStorageLike {
  private readonly entries: Array<[string, string | null]>;
  readonly getItemCalls: string[] = [];
  setItemCalls = 0;
  removeItemCalls = 0;
  clearCalls = 0;

  constructor(records: Record<string, string | null>, private readonly throwWhenReadingUnknown = false) {
    this.entries = Object.entries(records);
  }

  get length(): number {
    return this.entries.length;
  }

  key(index: number): string | null {
    return this.entries[index]?.[0] ?? null;
  }

  getItem(key: string): string | null {
    this.getItemCalls.push(key);
    const entry = this.entries.find(([candidate]) => candidate === key);
    if (!entry && this.throwWhenReadingUnknown) {
      throw new Error("unknown key should not be read");
    }
    return entry?.[1] ?? null;
  }

  setItem(): void {
    this.setItemCalls += 1;
    throw new Error("readonly storage must not write");
  }

  removeItem(): void {
    this.removeItemCalls += 1;
    throw new Error("readonly storage must not remove");
  }

  clear(): void {
    this.clearCalls += 1;
    throw new Error("readonly storage must not clear");
  }
}

export function makeLegacyAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 3,
    user: {
      id: "user-test",
      name: "Local Test User",
      email: "local@example.test",
      createdAt: FIXTURE_DATES.now
    },
    savedItems: [
      makeSavedItem("saved-001", {
        title: "小红书封面设计技巧 ✨",
        rawShareText: "保留中文和 Emoji ✨",
        userNote: "我想以后做封面时参考"
      })
    ],
    importBatches: [makeImportBatch("batch-001")],
    importBatchItems: [makeImportBatchItem("batch-item-001")],
    smartAlbums: [makeSmartAlbum("album-001")],
    actionCards: [makeActionCard("action-001")],
    planCards: [makePlanCard("plan-001")],
    classificationCorrections: [makeClassificationCorrection("correction-001")],
    searchLogs: [makeSearchLog("search-001")],
    ...overrides
  };
}

export function makeLegacyStorage(records: Partial<Record<string, string | null>> = {}): FakeReadonlyStorage {
  const appState = makeLegacyAppState();
  return new FakeReadonlyStorage({
    [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(appState),
    [LEGACY_THEME_STORAGE_KEY]: "sprout",
    [LEGACY_ACHIEVEMENT_STORAGE_KEY]: JSON.stringify({ first_import: FIXTURE_DATES.now }),
    [LEGACY_DEVELOPER_MODE_STORAGE_KEY]: "true",
    [LEGACY_REAL_USER_TEST_STORAGE_KEY]: JSON.stringify([{ id: "real-test-001" }]),
    [LEGACY_QA_WRITE_TEST_STORAGE_KEY]: "ok",
    "foreign-app-key": "foreign value must not be read",
    ...records
  }, true);
}

export function makeLargeLegacyAppState(): AppState {
  return makeLegacyAppState({
    savedItems: Array.from({ length: 3000 }, (_, index) =>
      makeSavedItem(`saved-${index.toString().padStart(4, "0")}`, {
        sourceUrl: `https://example.test/large/${index}`,
        title: `大体量收藏 ${index}`,
        displayTitle: `大体量收藏 ${index}`
      })
    ),
    importBatches: Array.from({ length: 100 }, (_, index) => makeImportBatch(`batch-${index.toString().padStart(3, "0")}`)),
    importBatchItems: Array.from({ length: 3000 }, (_, index) =>
      makeImportBatchItem(`batch-item-${index.toString().padStart(4, "0")}`, {
        batchId: `batch-${(index % 100).toString().padStart(3, "0")}`,
        createdSavedItemId: `saved-${index.toString().padStart(4, "0")}`
      })
    ),
    smartAlbums: Array.from({ length: 100 }, (_, index) =>
      makeSmartAlbum(`album-${index.toString().padStart(3, "0")}`, {
        savedItemIds: [`saved-${index.toString().padStart(4, "0")}`],
        recommendedItemIds: [`saved-${index.toString().padStart(4, "0")}`]
      })
    ),
    actionCards: Array.from({ length: 300 }, (_, index) =>
      makeActionCard(`action-${index.toString().padStart(3, "0")}`, {
        savedItemId: `saved-${index.toString().padStart(4, "0")}`
      })
    ),
    planCards: Array.from({ length: 100 }, (_, index) =>
      makePlanCard(`plan-${index.toString().padStart(3, "0")}`, {
        savedItemId: `saved-${index.toString().padStart(4, "0")}`,
        actionCardId: `action-${index.toString().padStart(3, "0")}`
      })
    ),
    classificationCorrections: Array.from({ length: 100 }, (_, index) =>
      makeClassificationCorrection(`correction-${index.toString().padStart(3, "0")}`, {
        savedItemId: `saved-${index.toString().padStart(4, "0")}`
      })
    )
  });
}
