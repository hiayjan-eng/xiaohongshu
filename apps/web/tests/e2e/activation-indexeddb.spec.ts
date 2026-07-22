import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors } from "./helpers";
import { seedMigrationFixture } from "./migration-preview-fixtures";

const MARKER_KEY = "collection-revival-storage-bootstrap:v1";
const LEGACY_KEYS = ["collection-revival-system:v1", "collection-revival-theme", "collection-revival-achievements"] as const;

 test.describe("Task 8D two-phase IndexedDB activation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/data-migration");
    await deleteDatabase(page);
    await page.evaluate((key) => localStorage.removeItem(key), MARKER_KEY);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate((key) => localStorage.removeItem(key), MARKER_KEY).catch(() => undefined);
    await page.reload().catch(() => undefined);
    await deleteDatabase(page).catch(() => undefined);
  });

  test("formal activation reloads, commits IndexedDB authority and keeps legacy bytes unchanged", async ({ page, context }) => {
    test.slow();
    const errors = collectConsoleErrors(page);
    await seedMigrationFixture(page);
    await completeMigration(page);
    const legacyBefore = await readLegacy(page);
    const oldLegacyTab = await context.newPage();
    await oldLegacyTab.goto("/");
    await expect(oldLegacyTab.locator("main")).toBeVisible();
    await expect(oldLegacyTab.getByTestId("app-write-gate-switching")).toHaveCount(0);

    await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
    await expect(page.getByTestId("activation-preflight-passed")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("activation-preflight-passed").getByRole("button", { name: "确认准备启用" }).click();
    const prepareBoxes = page.getByTestId("activation-prepare-confirmation").getByRole("checkbox");
    for (let index = 0; index < 4; index += 1) await prepareBoxes.nth(index).check();
    await page.getByTestId("activation-prepare-confirmation").getByRole("button", { name: "准备启用" }).click();
    await expect(page.getByTestId("activation-prepared")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("activation-prepared").getByRole("button", { name: "正式启用新存储" }).click();
    const formal = page.getByTestId("formal-activation-confirmation");
    await expect(formal).toBeVisible();
    await capture(page, "desktop-formal-confirmation");
    const formalBoxes = formal.getByRole("checkbox");
    await expect(formalBoxes).toHaveCount(4);
    await expect(formal.getByRole("button", { name: "开始正式启用" })).toBeDisabled();
    for (let index = 0; index < 4; index += 1) await formalBoxes.nth(index).check();

    const controlledReload = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
    await formal.getByRole("button", { name: "开始正式启用" }).click();
    await controlledReload;
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => readMarkerAcrossNavigation(page), { timeout: 20_000 }).toMatchObject({ state: "indexeddb_active", activeBackend: "indexedDB", revision: 3 });
    const metadata = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
    expect(metadata.some((entry) => entry.executionStatus === "completed" && entry.activeStorageSwitched === true)).toBe(true);
    expect(metadata.some((entry) => entry.recordType === "activation" && entry.status === "committed")).toBe(true);
    expect(await readLegacy(page)).toEqual(legacyBefore);
    await expect(oldLegacyTab.getByTestId("app-write-gate-switching")).toBeVisible({ timeout: 20_000 });
    await oldLegacyTab.reload();
    await expect(oldLegacyTab.locator("main")).toBeVisible({ timeout: 30_000 });
    await expect(oldLegacyTab.getByTestId("storage-recovery-screen")).toHaveCount(0);
    await expect.poll(() => readMarkerAcrossNavigation(oldLegacyTab), { timeout: 20_000 }).toMatchObject({ state: "indexeddb_active", activeBackend: "indexedDB" });
    await oldLegacyTab.close();
    await capture(page, "desktop-indexeddb-active");

    await page.goto("/settings");
    await expect(page.getByTestId("indexeddb-storage-status")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("storage-runtime-status")).toContainText("IndexedDB 已启用");
    await expect(page.getByTestId("indexeddb-storage-status")).toContainText("保留，只读历史快照");
    await capture(page, "desktop-storage-status");

    await page.getByTestId("theme-dawn").click();
    await expect.poll(async () => {
      const settings = await readRecords(page, "settings") as Array<{ key?: string; value?: unknown }>;
      return settings.find((entry) => entry.key === "collection-revival-theme")?.value;
    }).toBe("dawn");
    expect(await readLegacy(page)).toEqual(legacyBefore);
    await page.reload();
    await expect(page.getByTestId("theme-dawn")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    expect(await readLegacy(page)).toEqual(legacyBefore);

    await page.goto("/settings/data-migration");
    const task7Boundary = page.getByTestId("migration-recovery-recovery_blocked");
    await expect(task7Boundary).toBeVisible({ timeout: 30_000 });
    await expect(task7Boundary.getByRole("button", { name: /继续升级|恢复到升级前|继续恢复/ })).toHaveCount(0);
    await expect(page.getByTestId("start-migration-execution")).toHaveCount(0);
    await page.goto("/settings");

    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "mobile-storage-status");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await expectNoConsoleErrors(errors);
  });

  test("corrupt Marker opens startup Recovery without writable legacy fallback", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedMigrationFixture(page);
    await page.reload();
    const legacyBefore = await readLegacy(page);
    await page.evaluate((key) => localStorage.setItem(key, "{broken-marker"), MARKER_KEY);
    await page.goto("/");
    const recovery = page.getByTestId("storage-recovery-screen");
    await expect(recovery).toBeVisible({ timeout: 30_000 });
    await expect(recovery).toContainText("存储启动需要处理");
    await expect(recovery).toContainText("系统不会静默切回旧存储");
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await expect(recovery.getByRole("button", { name: /切回|清空/ })).toHaveCount(0);
    expect(await readLegacy(page)).toEqual(legacyBefore);
    await capture(page, "desktop-recovery-corrupt-marker");

    const download = page.waitForEvent("download");
    await recovery.getByRole("button", { name: "导出安全报告" }).click();
    expect((await download).suggestedFilename()).toMatch(/^collection-revival-storage-recovery-/);

    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "mobile-recovery-corrupt-marker");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await expectNoConsoleErrors(errors);
  });
});

async function readLegacy(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), [...LEGACY_KEYS]);
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = "test-results/task8d-indexeddb-activation";
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}
async function completeMigration(page: Page) {
  await page.goto("/settings/data-migration");
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByTestId("migration-preview-step")).toBeVisible();
  await page.getByTestId("open-backup-step").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("download-legacy-backup").click();
  await download;
  await page.getByTestId("continue-to-migration-confirmation").click();
  const confirmation = page.getByTestId("migration-confirmation-step");
  const checkboxes = confirmation.getByRole("checkbox");
  for (let index = 0; index < await checkboxes.count(); index += 1) await checkboxes.nth(index).check();
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("activation-preflight-idle")).toBeVisible();
}

async function readMarker(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }, MARKER_KEY);
}

async function readMarkerAcrossNavigation(page: Page): Promise<Record<string, unknown> | null> {
  try {
    return await readMarker(page);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Execution context was destroyed")) return null;
    throw error;
  }
}

async function readRecords(page: Page, storeName: string): Promise<unknown[]> {
  return page.evaluate(({ storeName }) => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open("collection-revival-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const records = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      records.onsuccess = () => { database.close(); resolve(records.result); };
      records.onerror = () => reject(records.error);
    };
  }), { storeName });
}

async function deleteDatabase(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("collection-revival-local");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Task 8D test database deletion was blocked."));
  }));
}