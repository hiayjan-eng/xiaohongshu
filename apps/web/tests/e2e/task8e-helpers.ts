import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { ACHIEVEMENT_STORAGE_KEY, STORAGE_KEY } from "./helpers";

export const TASK8E_DATABASE_NAME = "collection-revival-local";
export const TASK8E_MARKER_KEY = "collection-revival-storage-bootstrap:v1";
export const TASK8E_THEME_KEY = "collection-revival-theme";
export const TASK8E_LEGACY_KEYS = [STORAGE_KEY, TASK8E_THEME_KEY, ACHIEVEMENT_STORAGE_KEY] as const;
export const TASK8E_ARTIFACT_DIR = "test-results/task8e-independent-acceptance";

const NOW = "2026-07-19T08:00:00.000Z";

export async function seedCompactLegacyFixture(page: Page, itemCount: number): Promise<void> {
  const state = makeCompactLegacyState(itemCount);
  await seedLegacyStateOnce(page, state);
}

export async function persistTask8eOrderOnly(page: Page): Promise<{ beforeFirstId: string; afterFirstId: string }> {
  const runtimeModuleUrl = viteFsModuleUrl("../../../../packages/storage-runtime/src/index.ts");
  const serviceModuleUrl = viteFsModuleUrl("../../../../packages/storage-service/src/index.ts");
  return page.evaluate(async ({ runtimeModuleUrl, serviceModuleUrl, databaseName }) => {
    type RuntimeState = { savedItems: Array<{ id: string }> };
    type RuntimeLoad = { state: RuntimeState; settings: unknown };
    type RuntimeInstance = {
      open(): Promise<void>;
      close(): Promise<void>;
      loadAppState(): Promise<RuntimeLoad>;
      persistAppState(before: RuntimeState, after: RuntimeState): Promise<void>;
    };
    const serviceModule = await import(serviceModuleUrl) as {
      IndexedDbAdapter: new (options: { databaseName: string; schemaVersion: number }) => unknown;
    };
    const runtimeModule = await import(runtimeModuleUrl) as {
      IndexedDbRuntime: new (options: { adapter: unknown; expectedSchemaVersion: number }) => RuntimeInstance;
    };
    const adapter = new serviceModule.IndexedDbAdapter({ databaseName, schemaVersion: 1 });
    const runtime = new runtimeModule.IndexedDbRuntime({ adapter, expectedSchemaVersion: 1 });
    await runtime.open();
    try {
      const loaded = await runtime.loadAppState();
      const beforeFirstId = loaded.state.savedItems[0]?.id ?? "";
      const reordered = { ...loaded.state, savedItems: [...loaded.state.savedItems].reverse() };
      await runtime.persistAppState(loaded.state, reordered);
      return { beforeFirstId, afterFirstId: reordered.savedItems[0]?.id ?? "" };
    } finally {
      await runtime.close();
    }
  }, { runtimeModuleUrl, serviceModuleUrl, databaseName: TASK8E_DATABASE_NAME });
}

function viteFsModuleUrl(relativePath: string): string {
  const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url)).replaceAll("\\", "/");
  return `/@fs/${absolutePath}`;
}
export async function seedLegacyStateOnce(page: Page, state: unknown): Promise<void> {
  await page.evaluate(({ state, storageKey, achievementKey, themeKey }) => {
    localStorage.setItem(storageKey, JSON.stringify(state));
    localStorage.setItem(achievementKey, JSON.stringify({ first_revival: "2026-07-19T08:00:00.000Z" }));
    localStorage.setItem(themeKey, "lavender-mint");
  }, { state, storageKey: STORAGE_KEY, achievementKey: ACHIEVEMENT_STORAGE_KEY, themeKey: TASK8E_THEME_KEY });
}

export function makeCompactLegacyState(itemCount: number) {
  const savedItems = Array.from({ length: itemCount }, (_, index) => {
    const number = String(index + 1).padStart(5, "0");
    return {
      id: `large-${number}`,
      userId: "u",
      sourcePlatform: "manual",
      sourceUrl: `https://e.test/${number}`,
      displayTitle: `Task8E ${number}`,
      textNormalizationVersion: 3,
      title: `Task8E ${number}`,
      userNote: index === 0 ? "manual note" : "",
      contentDomain: "技能学习",
      contentSubDomain: "通用技能",
      savedIntent: "以后查阅",
      summary: "",
      keywords: ["Task8E", number],
      entities: [],
      searchableText: `Task8E ${number}`,
      status: "not_started",
      createdAt: NOW,
      updatedAt: NOW
    };
  });
  return {
    schemaVersion: 3,
    user: { id: "task8e-user", name: "Task8E 用户", email: "task8e@example.test", createdAt: NOW },
    savedItems,
    importBatches: [],
    importBatchItems: [],
    smartAlbums: itemCount > 0 ? [{
      id: "large-album-1", title: "Task8E 大数据专辑", description: "浏览器验收",
      albumView: "content_domain", contentDomain: "技能学习", contentSubDomain: "通用技能",
      category: "技能学习", albumType: "topic", keywords: ["Task8E"],
      savedItemIds: savedItems.slice(0, 50).map((item) => item.id),
      recommendedItemIds: savedItems.slice(0, 3).map((item) => item.id),
      suggestedItemIds: [], manuallyAddedItemIds: [], manuallyRemovedItemIds: [],
      whyThisAlbum: "同一验收主题", whyStartHere: "从第一条开始", suggestedFirstAction: "查看第一条",
      priority: "medium", priorityScore: 50, status: "confirmed", confirmedAt: NOW,
      autoCollectEnabled: true, mediumMatchRequiresApproval: true, createdAt: NOW, updatedAt: NOW
    }] : [],
    actionCards: itemCount > 0 ? [{
      id: "large-action-1",
      savedItemId: savedItems[0].id,
      category: "技能学习",
      subCategory: "通用技能",
      title: "Task8E 大数据行动卡",
      goal: "验证激活后的行动记录",
      whySaved: "独立验收",
      nextAction: "查看第一条收藏",
      openOriginalFocus: ["第一条收藏"],
      output: "一条验收记录",
      estimatedTime: "10分钟",
      difficulty: "低",
      doneCriteria: "行动记录可读取",
      avoidDoing: "不修改真实数据",
      ifInfoMissing: "保留原记录",
      followUp: "完成刷新验证",
      fields: {},
      tasks: [],
      createdAt: NOW,
      updatedAt: NOW
    }] : [],
    planCards: itemCount > 0 ? [{
      id: "large-plan-1",
      savedItemId: savedItems[0].id,
      actionCardId: "large-action-1",
      title: "Task8E 大数据计划卡",
      sourceTitle: savedItems[0].title,
      plannedDate: "2026-07-19",
      estimatedMinutes: 10,
      oneNextStep: "查看第一条收藏",
      doneCriteria: "计划记录可读取",
      status: "planned",
      reminderEnabled: false,
      createdAt: NOW,
      updatedAt: NOW
    }] : [],
    classificationCorrections: [],
    searchLogs: []
  };
}

export async function installLegacyBootProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = { indexedDbOpenCalls: 0 };
    Object.defineProperty(window, "__TASK8E_BOOT_PROBE__", { value: probe, configurable: true });
    const originalOpen = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (...args: Parameters<IDBFactory["open"]>) => {
        probe.indexedDbOpenCalls += 1;
        return originalOpen(...args);
      }
    });
  });
}

export async function readLegacyBytes(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), [...TASK8E_LEGACY_KEYS]);
}

export async function readTask8eMarker(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, TASK8E_MARKER_KEY);
}

export async function readTask8eRecords<T = Record<string, unknown>>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate(({ databaseName, storeName }) => new Promise<T[]>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const records = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      records.onsuccess = () => { database.close(); resolve(records.result as T[]); };
      records.onerror = () => reject(records.error);
    };
  }), { databaseName: TASK8E_DATABASE_NAME, storeName });
}

export async function deleteTask8eDatabase(page: Page): Promise<void> {
  await page.evaluate((databaseName) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Task 8E database deletion was blocked."));
  }), TASK8E_DATABASE_NAME);
}

export async function runMigrationToCompleted(page: Page): Promise<void> {
  await page.goto("/settings/data-migration");
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByTestId("migration-preview-step")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("open-backup-step").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("download-legacy-backup").click();
  await download;
  await page.getByTestId("continue-to-migration-confirmation").click();
  const confirmation = page.getByTestId("migration-confirmation-step");
  const boxes = confirmation.getByRole("checkbox");
  for (let index = 0; index < await boxes.count(); index += 1) await boxes.nth(index).check();
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 180_000 });
}

export async function prepareActivation(page: Page): Promise<void> {
  await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
  await expect(page.getByTestId("activation-preflight-passed")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("activation-preflight-passed").getByRole("button", { name: "确认准备启用" }).click();
  const confirmation = page.getByTestId("activation-prepare-confirmation");
  const boxes = confirmation.getByRole("checkbox");
  for (let index = 0; index < await boxes.count(); index += 1) await boxes.nth(index).check();
  await confirmation.getByRole("button", { name: "准备启用" }).click();
  await expect(page.getByTestId("activation-prepared")).toBeVisible({ timeout: 120_000 });
}

export async function activatePreparedStorage(page: Page): Promise<void> {
  await page.getByTestId("activation-prepared").getByRole("button", { name: "正式启用新存储" }).click();
  const confirmation = page.getByTestId("formal-activation-confirmation");
  const boxes = confirmation.getByRole("checkbox");
  for (let index = 0; index < await boxes.count(); index += 1) await boxes.nth(index).check();
  await confirmation.getByRole("button", { name: "开始正式启用" }).click();
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 180_000 });
  await expect.poll(async () => {
    try {
      return await readTask8eMarker(page);
    } catch {
      return null;
    }
  }, { timeout: 60_000 }).toMatchObject({ state: "indexeddb_active", activeBackend: "indexedDB" });
}

export async function runFullActivation(page: Page): Promise<void> {
  await runMigrationToCompleted(page);
  await prepareActivation(page);
  await activatePreparedStorage(page);
}

export async function captureTask8e(page: Page, name: string): Promise<string> {
  await fs.mkdir(TASK8E_ARTIFACT_DIR, { recursive: true });
  const path = `${TASK8E_ARTIFACT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

declare global {
  interface Window {
    __TASK8E_BOOT_PROBE__?: { indexedDbOpenCalls: number };
  }
}
