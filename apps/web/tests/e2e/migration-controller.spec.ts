import { expect, test } from "@playwright/test";
import {
  LEGACY_ACHIEVEMENT_STORAGE_KEY,
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_DEVELOPER_MODE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  type ReadonlyStorageLike
} from "@revival/storage-service";
import { MigrationFlowController } from "../../src/features/storage-migration/migration-flow-controller";
import { initialMigrationPreviewUiState, migrationPreviewReducer } from "../../src/features/storage-migration/migration-preview-reducer";
import { makeMigrationAppState } from "./migration-preview-fixtures";

class FakeReadonlyStorage implements ReadonlyStorageLike {
  readonly reads: string[] = [];
  readonly keys: string[];

  constructor(private readonly records: Record<string, string | null>) {
    this.keys = Object.keys(records);
  }

  get length() {
    return this.keys.length;
  }

  getItem(key: string) {
    this.reads.push(key);
    if (key === "unknown-third-party-key") throw new Error("Unknown values must not be read");
    return this.records[key] ?? null;
  }

  key(index: number) {
    return this.keys[index] ?? null;
  }
}

function createValidStorage(overrides: Record<string, string | null> = {}) {
  return new FakeReadonlyStorage({
    [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeMigrationAppState()),
    [LEGACY_THEME_STORAGE_KEY]: "lavender-mint",
    [LEGACY_ACHIEVEMENT_STORAGE_KEY]: JSON.stringify({ first_revival: "2026-07-16T08:00:00.000Z" }),
    [LEGACY_DEVELOPER_MODE_STORAGE_KEY]: "true",
    "unknown-third-party-key": "must stay unread",
    ...overrides
  });
}

test.describe("Task 7A migration flow controller", () => {
  test("constructor is inert and inspect reads only allowlisted product keys", async () => {
    const storage = createValidStorage();
    const controller = new MigrationFlowController(storage);
    expect(storage.reads).toEqual([]);

    const progress: string[] = [];
    const result = await controller.inspect((entry) => progress.push(entry.stage));
    expect(result.envelope.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY]).toBeTruthy();
    expect(result.preview.stores.savedItems?.sourceCount).toBe(1);
    expect(result.userSummary.counts.smartAlbums).toBe(1);
    expect(result.plan).toBe(result.preview.plan);
    expect(progress).toEqual([
      "reading_local_data",
      "creating_raw_backup",
      "validating_structure",
      "checking_preserved_data",
      "creating_preview"
    ]);
    expect(storage.reads).toEqual(expect.arrayContaining([
      LEGACY_APP_STATE_STORAGE_KEY,
      LEGACY_THEME_STORAGE_KEY,
      LEGACY_ACHIEVEMENT_STORAGE_KEY
    ]));
    expect(storage.reads).not.toContain(LEGACY_DEVELOPER_MODE_STORAGE_KEY);
    expect(storage.reads).not.toContain("unknown-third-party-key");
  });

  test("valid data prepares the canonical Task 4 backup download", async () => {
    const controller = new MigrationFlowController(createValidStorage());
    const result = await controller.inspect();
    const prepared = controller.prepareBackupDownload();
    expect(prepared.filename).toMatch(/^collection-revival-backup-\d{8}-\d{6}\.json$/);
    expect(prepared.blob.type).toBe("application/json;charset=utf-8");
    expect(JSON.parse(prepared.serialized).backupId).toBe(result.envelope.backupId);
    expect(controller.getCurrentResult()).toBe(result);
  });

  test("corrupt AppState remains exportable as raw backup and is blocked", async () => {
    const controller = new MigrationFlowController(createValidStorage({
      [LEGACY_APP_STATE_STORAGE_KEY]: "{not-json"
    }));
    const result = await controller.inspect();
    expect(result.disposition).toBe("blocked");
    expect(result.rawBackupAvailable).toBe(true);
    expect(result.envelope.normalizedSnapshot).toBeUndefined();
    expect(result.envelope.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY]).toBe("{not-json");
  });

  test("missing AppState produces the no-data disposition without demo data", async () => {
    const controller = new MigrationFlowController(createValidStorage({
      [LEGACY_APP_STATE_STORAGE_KEY]: null
    }));
    const result = await controller.inspect();
    expect(result.disposition).toBe("empty");
    expect(result.hasProductData).toBe(false);
    expect(result.envelope.normalizedSnapshot).toBeUndefined();
  });

  test("duplicate source data enters review_required", async () => {
    const storage = createValidStorage({
      [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeMigrationAppState({ duplicateSource: true }))
    });
    const result = await new MigrationFlowController(storage).inspect();
    expect(result.disposition).toBe("review_required");
    expect(result.preview.issues.some((issue) => issue.code === "NORMALIZED_URL_DUPLICATE")).toBe(true);
  });

  test("reducer expresses every Task 7A state without boolean combinations", () => {
    const inspecting = migrationPreviewReducer(initialMigrationPreviewUiState, {
      type: "START_INSPECTION",
      progress: { stage: "reading_local_data", label: "正在读取" }
    });
    expect(inspecting.status).toBe("inspecting");
    const failed = migrationPreviewReducer(inspecting, {
      type: "INSPECTION_FAILED",
      error: { code: "INSPECTION_FAILED", message: "检查失败" }
    });
    expect(failed).toEqual({ status: "inspection_failed", error: { code: "INSPECTION_FAILED", message: "检查失败" } });
    expect(migrationPreviewReducer(failed, { type: "RESET" })).toEqual({ status: "idle" });
  });

  test("Task 7A source boundary has no executor, Web Locks, or IndexedDB runtime wiring", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const featureDir = path.resolve(process.cwd(), "src/features/storage-migration");
    const files = (await fs.readdir(featureDir)).filter((name) => /\.(ts|tsx)$/.test(name));
    const source = (await Promise.all(files.map((name) => fs.readFile(path.join(featureDir, name), "utf8")))).join("\n");
    expect(source).not.toContain("MigrationExecutor");
    expect(source).not.toContain("IndexedDbAdapter");
    expect(source).not.toContain("WebLocksMigrationLockProvider");
    expect(source).not.toContain("indexedDB.open");
    expect(source).not.toContain("localStorage.setItem");
    expect(source).not.toContain("localStorage.removeItem");
    expect(source).not.toContain("localStorage.clear");
  });
});
