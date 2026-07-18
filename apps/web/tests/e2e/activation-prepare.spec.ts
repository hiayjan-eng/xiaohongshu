import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors } from "./helpers";
import { seedMigrationFixture } from "./migration-preview-fixtures";

const DATABASE_NAME = "collection-revival-local";
const MARKER_KEY = "collection-revival-storage-bootstrap:v1";

test.describe("Task 8C activation prepare", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await deleteDatabase(page);
    await page.evaluate((key) => localStorage.removeItem(key), MARKER_KEY);
  });

  test.afterEach(async ({ page }) => {
    await page.goto("/settings/data-migration");
    await deleteDatabase(page);
    await page.evaluate((key) => localStorage.removeItem(key), MARKER_KEY);
  });

  test("completed migration passes full preflight, prepares without activation, and can cancel", async ({ page }) => {
    test.slow();
    await seedMigrationFixture(page);

    const errors = collectConsoleErrors(page);
    await completeMigration(page);
    const sourceBefore = await page.evaluate(() => ({
      state: localStorage.getItem("collection-revival-system:v1"),
      theme: localStorage.getItem("collection-revival-theme"),
      achievements: localStorage.getItem("collection-revival-achievements")
    }));

    await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
    const passed = page.getByTestId("activation-preflight-passed");
    await expect(passed).toBeVisible({ timeout: 30_000 });
    await expect(passed).toContainText("所有启用条件已经通过");
    await expect(passed).toContainText("旧本地存储");
    await capture(page, "desktop-preflight-ready");

    const reportDownload = page.waitForEvent("download");
    await passed.getByRole("button", { name: "下载安全报告" }).click();
    const report = await reportDownload;
    expect(report.suggestedFilename()).toMatch(/^collection-revival-activation-preflight-/);
    const reportPath = await report.path();
    expect(reportPath).toBeTruthy();
    const reportText = await fs.readFile(reportPath!, "utf8");
    expect(reportText).not.toMatch(/[a-f0-9]{64}/);

    await passed.getByRole("button", { name: "确认准备启用" }).click();
    const confirmation = page.getByTestId("activation-prepare-confirmation");
    const boxes = confirmation.getByRole("checkbox");
    await expect(boxes).toHaveCount(4);
    await capture(page, "desktop-prepare-confirmation");
    for (let index = 0; index < 4; index += 1) await boxes.nth(index).check();
    await confirmation.getByRole("button", { name: "准备启用" }).click();

    const prepared = page.getByTestId("activation-prepared");
    await expect(prepared).toBeVisible({ timeout: 30_000 });
    await expect(prepared).toContainText("尚未切换");
    await expect(prepared).toContainText("localStorage");
    await capture(page, "desktop-activation-prepared");
    const marker = await readMarker(page);
    expect(marker).toMatchObject({ state: "activation_prepared", activeBackend: "localStorage", revision: 1 });
    const metadata = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
    expect(metadata.some((entry) => entry.recordType === "activation" && entry.status === "prepared")).toBe(true);
    expect(metadata.some((entry) => entry.executionStatus === "completed" && entry.activeStorageSwitched === false)).toBe(true);
    expect(await page.evaluate(() => location.pathname)).toBe("/settings/data-migration");
    expect(await page.evaluate(() => ({
      state: localStorage.getItem("collection-revival-system:v1"),
      theme: localStorage.getItem("collection-revival-theme"),
      achievements: localStorage.getItem("collection-revival-achievements")
    }))).toEqual(sourceBefore);

    page.once("dialog", (dialog) => dialog.accept());
    await prepared.getByRole("button", { name: "取消准备" }).click();
    await expect(page.getByTestId("activation-preflight-idle")).toBeVisible({ timeout: 20_000 });
    await capture(page, "desktop-prepare-cancelled");
    expect(await readMarker(page)).toMatchObject({ state: "legacy_active", activeBackend: "localStorage", revision: 2 });
    const afterCancel = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
    expect(afterCancel.some((entry) => entry.recordType === "activation" && entry.status === "cancelled")).toBe(true);
    expect((await readRecords(page, "backups")).length).toBe(1);
    await expectNoConsoleErrors(errors);
  });

  test("theme drift blocks prepare and writes neither Marker nor Activation Journal", async ({ page }) => {
    test.slow();
    await seedMigrationFixture(page);
    await completeMigration(page);
    await page.evaluate(() => localStorage.setItem("collection-revival-theme", "task8c-drift-theme"));
    await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
    const drift = page.getByTestId("activation-source-drift");
    await expect(drift).toBeVisible({ timeout: 30_000 });
    await expect(drift).toContainText("当前收藏在迁移后发生了变化");
    await expect(drift).toContainText("主题");
    await capture(page, "desktop-source-drift");
    await expect(drift.getByRole("button", { name: "确认准备启用" })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), MARKER_KEY)).toBeNull();
    const metadata = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
    expect(metadata.filter((entry) => entry.recordType === "activation")).toHaveLength(0);
  });

  test("target data mismatch blocks prepare without changing authority", async ({ page }) => {
    test.slow();
    await seedMigrationFixture(page);
    await completeMigration(page);
    await page.evaluate((databaseName) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("savedItems", "readwrite");
        const store = transaction.objectStore("savedItems");
        const read = store.get("saved-migration-001");
        read.onsuccess = () => store.put({ ...read.result, userNote: "safe-target-drift" });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    }), DATABASE_NAME);
    await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
    const mismatch = page.getByTestId("activation-target-mismatch");
    await expect(mismatch).toBeVisible({ timeout: 30_000 });
    await expect(mismatch).toContainText("新存储与当前收藏不完全一致");
    await expect(mismatch.getByRole("button", { name: "确认准备启用" })).toHaveCount(0);
    expect(await readMarker(page)).toBeNull();
    const metadata = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
    expect(metadata.filter((entry) => entry.recordType === "activation")).toHaveLength(0);
    await capture(page, "desktop-target-mismatch");
  });

  test("two tabs preparing concurrently converge on one Marker and one Journal", async ({ page, context }) => {
    test.slow();
    await seedMigrationFixture(page);
    await completeMigration(page);
    const second = await context.newPage();
    try {
      await second.goto("/settings/data-migration");
      await expect(second.getByTestId("activation-preflight-idle")).toBeVisible({ timeout: 20_000 });
      await Promise.all([
        page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click(),
        second.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click()
      ]);
      await Promise.all([
        expect(page.getByTestId("activation-preflight-passed")).toBeVisible({ timeout: 30_000 }),
        expect(second.getByTestId("activation-preflight-passed")).toBeVisible({ timeout: 30_000 })
      ]);
      await page.getByTestId("activation-preflight-passed").getByRole("button", { name: "确认准备启用" }).click();
      await second.getByTestId("activation-preflight-passed").getByRole("button", { name: "确认准备启用" }).click();
      for (const target of [page, second]) {
        const boxes = target.getByTestId("activation-prepare-confirmation").getByRole("checkbox");
        for (let index = 0; index < 4; index += 1) await boxes.nth(index).check();
      }
      await Promise.all([
        page.getByTestId("activation-prepare-confirmation").getByRole("button", { name: "准备启用" }).click(),
        second.getByTestId("activation-prepare-confirmation").getByRole("button", { name: "准备启用" }).click()
      ]);
      await expect.poll(async () =>
        await page.getByTestId("activation-prepared").count() +
        await page.getByTestId("activation-another-tab-active").count() +
        await second.getByTestId("activation-prepared").count() +
        await second.getByTestId("activation-another-tab-active").count()
      , { timeout: 30_000 }).toBe(2);
      const pages = [page, second];
      const preparedPages = [];
      const waitingPages = [];
      for (const target of pages) {
        if (await target.getByTestId("activation-prepared").count()) preparedPages.push(target);
        if (await target.getByTestId("activation-another-tab-active").count()) waitingPages.push(target);
      }
      expect(preparedPages.length).toBeGreaterThanOrEqual(1);
      expect(preparedPages.length + waitingPages.length).toBe(2);
      expect(await readMarker(page)).toMatchObject({ state: "activation_prepared", revision: 1 });
      const metadata = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
      expect(metadata.filter((entry) => entry.recordType === "activation")).toHaveLength(1);
      if (waitingPages[0]) {
        await expect(waitingPages[0].getByTestId("activation-another-tab-active")).toContainText("另一个页面正在处理");
        await capture(waitingPages[0], "desktop-concurrent-prepare");
        await waitingPages[0].getByTestId("activation-another-tab-active").getByRole("button", { name: "重新检查" }).click();
        await expect(waitingPages[0].getByTestId("activation-prepared")).toBeVisible({ timeout: 30_000 });
      } else {
        await capture(second, "desktop-concurrent-prepare");
      }
    } finally {
      await second.close();
    }
  });

  test("prepared or corrupt Marker blocks ordinary app boot without opening IndexedDB authority", async ({ page }) => {
    const preparedMarker = {
      version: 1, revision: 1, state: "activation_prepared", activeBackend: "localStorage",
      migrationId: "migration-1", activationId: "activation-1", journalId: "activation:activation-1",
      databaseName: "collection-revival-local", schemaVersion: 1,
      sourceRawChecksum: "a".repeat(64), sourceNormalizedChecksum: "b".repeat(64), targetRuntimeChecksum: "c".repeat(64),
      preparedAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z"
    };
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: MARKER_KEY, value: preparedMarker });
    await page.goto("/");
    await expect(page.getByTestId("app-activation-prepared")).toBeVisible();
    await expect(page.getByTestId("app-activation-prepared")).toContainText("尚未切换");
    expect((await page.evaluate(() => indexedDB.databases())).some((entry) => entry.name === DATABASE_NAME)).toBe(false);
    await capture(page, "desktop-prepared-startup-block");

    await page.evaluate((key) => localStorage.setItem(key, "{broken"), MARKER_KEY);
    await page.reload();
    await expect(page.getByTestId("app-storage-recovery-required")).toBeVisible();
    await expect(page.getByTestId("app-storage-recovery-required")).toContainText("不会猜测数据源");
    await capture(page, "desktop-marker-recovery-required");
  });

  test("mobile activation preflight and confirmation do not overflow horizontally", async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMigrationFixture(page);
    await completeMigration(page);
    await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
    await expect(page.getByTestId("activation-preflight-passed")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await page.getByTestId("activation-preflight-passed").getByRole("button", { name: "确认准备启用" }).click();
    await expect(page.getByTestId("activation-prepare-confirmation")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  });
});

async function capture(page: Page, name: string): Promise<void> {
  const directory = "test-results/task8c-activation-preflight";
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

async function readRecords(page: Page, storeName: string): Promise<unknown[]> {
  return page.evaluate(({ databaseName, storeName }) => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const records = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      records.onsuccess = () => { database.close(); resolve(records.result); };
      records.onerror = () => reject(records.error);
    };
  }), { databaseName: DATABASE_NAME, storeName });
}

async function deleteDatabase(page: Page) {
  await page.evaluate((databaseName) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Task 8C test database deletion was blocked."));
  }), DATABASE_NAME);
}