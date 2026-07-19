import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, STORAGE_KEY, submitQuickImportForm } from "./helpers";
import { seedMigrationFixture } from "./migration-preview-fixtures";
import {
  activatePreparedStorage,
  captureTask8e,
  deleteTask8eDatabase,
  installLegacyBootProbe,
  prepareActivation,
  readLegacyBytes,
  readTask8eMarker,
  readTask8eRecords,
  runFullActivation,
  runMigrationToCompleted,
  seedCompactLegacyFixture,
  TASK8E_DATABASE_NAME,
  TASK8E_MARKER_KEY
} from "./task8e-helpers";

test.describe("Task 8E independent release acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await deleteTask8eDatabase(page);
    await page.evaluate((key) => localStorage.removeItem(key), TASK8E_MARKER_KEY);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate((key) => localStorage.removeItem(key), TASK8E_MARKER_KEY).catch(() => undefined);
    await page.reload().catch(() => undefined);
    await deleteTask8eDatabase(page).catch(() => undefined);
  });

  test("legacy default path opens no IndexedDB, creates no Marker, and keeps CRUD on localStorage", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await installLegacyBootProbe(page);
    await seedMigrationFixture(page);
    await page.goto("/dashboard");
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__TASK8E_BOOT_PROBE__?.indexedDbOpenCalls)).toBe(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), TASK8E_MARKER_KEY)).toBeNull();
    expect((await page.evaluate(() => indexedDB.databases())).some((entry) => entry.name === TASK8E_DATABASE_NAME)).toBe(false);

    const before = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!);
    await page.goto("/import");
    await page.getByTestId("import-source-url").fill("https://example.test/task8e-legacy-import");
    await page.getByTestId("import-title").fill("Task 8E legacy 写入验证");
    await page.getByTestId("import-user-note").fill("只应写入旧 AppState");
    await submitQuickImportForm(page);
    await expect(page.getByTestId("import-success-panel")).toBeVisible();
    const after = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!);
    expect(after.savedItems.length).toBe(before.savedItems.length + 1);
    expect(await page.evaluate(() => window.__TASK8E_BOOT_PROBE__?.indexedDbOpenCalls)).toBe(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), TASK8E_MARKER_KEY)).toBeNull();

    await page.reload();
    await page.goto("/search?q=Task%208E%20legacy");
    await expect(page.getByTestId("search-result-card")).toContainText("Task 8E legacy 写入验证");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    await captureTask8e(page, "legacy-mobile-search");
    await expectNoConsoleErrors(errors);
  });

  test("full migration and activation preserve legacy bytes and make IndexedDB the only writer", async ({ page }) => {
    test.slow();
    test.setTimeout(300_000);
    const errors = collectConsoleErrors(page);
    await seedMigrationFixture(page);
    await page.goto("/");
    const legacyBefore = await readLegacyBytes(page);
    await runFullActivation(page);

    const metadata = await readTask8eRecords<Record<string, unknown>>(page, "migrationMetadata");
    expect(metadata.some((record) => record.executionStatus === "completed" && record.activeStorageSwitched === true)).toBe(true);
    expect(metadata.some((record) => record.recordType === "activation" && record.status === "committed")).toBe(true);
    expect(await readLegacyBytes(page)).toEqual(legacyBefore);

    const beforeItems = await readTask8eRecords<Record<string, unknown>>(page, "savedItems");
    await page.goto("/import");
    await page.getByTestId("import-source-url").fill("https://example.test/task8e-indexeddb-import");
    await page.getByTestId("import-title").fill("Task 8E IndexedDB 新收藏");
    await page.getByTestId("import-user-note").fill("激活后持久化验证");
    await submitQuickImportForm(page);
    await expect(page.getByTestId("import-success-panel")).toBeVisible();
    await expect.poll(async () => (await readTask8eRecords(page, "savedItems")).length).toBe(beforeItems.length + 1);
    const afterItems = await readTask8eRecords<Record<string, unknown>>(page, "savedItems");
    const imported = afterItems.find((record) => record.sourceUrl === "https://example.test/task8e-indexeddb-import");
    expect(imported).toBeTruthy();
    expect(await readLegacyBytes(page)).toEqual(legacyBefore);

    await page.getByTestId("revive-imported-item").click();
    await expect.poll(async () => (await readTask8eRecords<Record<string, unknown>>(page, "actionCards")).some((card) => card.savedItemId === imported!.id)).toBe(true);
    let dialogIndex = 0;
    page.on("dialog", async (dialog) => {
      dialogIndex += 1;
      await dialog.accept(dialogIndex === 1 ? "今天" : dialogIndex === 2 ? "20" : dialog.defaultValue());
    });
    await page.getByTestId("add-to-plan-card").click();
    await expect.poll(async () => (await readTask8eRecords<Record<string, unknown>>(page, "planCards")).some((card) => card.savedItemId === imported!.id)).toBe(true);

    await page.goto("/albums/album-migration-001");
    await expect(page.getByTestId("album-detail")).toBeVisible();
    page.removeAllListeners("dialog");
    let correctionDialog = 0;
    page.on("dialog", async (dialog) => {
      correctionDialog += 1;
      await dialog.accept(correctionDialog === 1 ? "工作与职业" : "招聘求职");
    });
    await page.getByRole("button", { name: "改主题" }).first().click();
    await expect.poll(async () => (await readTask8eRecords(page, "classificationCorrections")).length).toBeGreaterThan(1);

    await page.goto("/settings");
    await page.getByTestId("theme-dawn").click();
    await expect.poll(async () => {
      const settings = await readTask8eRecords<{ key: string; value: unknown }>(page, "settings");
      return settings.find((setting) => setting.key === "collection-revival-theme")?.value;
    }).toBe("dawn");
    expect(await readLegacyBytes(page)).toEqual(legacyBefore);
    await page.reload();
    await expect(page.getByTestId("indexeddb-storage-status")).toBeVisible();
    await captureTask8e(page, "indexeddb-active-storage-status");
    await expectNoConsoleErrors(errors);
  });

  test("old legacy tab freezes during activation and resumes only after reload into IndexedDB", async ({ page, context }) => {
    test.slow();
    test.setTimeout(300_000);
    await seedMigrationFixture(page);
    await page.goto("/");
    const legacyBefore = await readLegacyBytes(page);
    const oldTab = await context.newPage();
    await oldTab.goto("/dashboard");
    await expect(oldTab.locator(".app-shell")).toBeVisible();

    await runMigrationToCompleted(page);
    await prepareActivation(page);
    await activatePreparedStorage(page);
    await expect(oldTab.getByTestId("app-write-gate-switching")).toBeVisible({ timeout: 30_000 });
    expect(await readLegacyBytes(oldTab)).toEqual(legacyBefore);
    await captureTask8e(oldTab, "old-tab-write-gate");
    await oldTab.reload();
    await expect(oldTab.locator(".app-shell")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => readTask8eMarker(oldTab)).toMatchObject({ state: "indexeddb_active" });
    expect(await readLegacyBytes(oldTab)).toEqual(legacyBefore);
    await oldTab.close();
  });

  test("source drift blocks authoritative changes and ignores internal keys", async ({ page }) => {
    test.slow();
    test.setTimeout(360_000);
    await seedMigrationFixture(page);
    await runMigrationToCompleted(page);
    const originalState = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const originalTheme = await page.evaluate(() => localStorage.getItem("collection-revival-theme"));
    const originalAchievements = await page.evaluate(() => localStorage.getItem("collection-revival-achievements"));

    const mutations = [
      () => page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)!); state.savedItems[0].userNote = "drift-note"; localStorage.setItem(key, JSON.stringify(state)); }, STORAGE_KEY),
      () => page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)!); state.savedItems[0].title = "drift-title"; localStorage.setItem(key, JSON.stringify(state)); }, STORAGE_KEY),
      () => page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)!); state.smartAlbums[0].title = "drift-album"; localStorage.setItem(key, JSON.stringify(state)); }, STORAGE_KEY),
      () => page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)!); state.actionCards[0].nextAction = "drift-action"; localStorage.setItem(key, JSON.stringify(state)); }, STORAGE_KEY),
      () => page.evaluate((key) => { const state = JSON.parse(localStorage.getItem(key)!); state.planCards[0].plannedDate = "2026-07-20"; localStorage.setItem(key, JSON.stringify(state)); }, STORAGE_KEY),
      () => page.evaluate(() => localStorage.setItem("collection-revival-theme", "drift-theme")),
      () => page.evaluate(() => localStorage.setItem("collection-revival-achievements", JSON.stringify({ drift: "2026-07-19" })))
    ];

    for (const mutate of mutations) {
      await page.goto("/settings/data-migration");
      await mutate();
      await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
      await expect(page.getByTestId("activation-source-drift")).toBeVisible({ timeout: 60_000 });
      expect(await page.evaluate((key) => localStorage.getItem(key), TASK8E_MARKER_KEY)).toBeNull();
      await page.evaluate(({ key, state, theme, achievements }) => {
        localStorage.setItem(key, state!);
        localStorage.setItem("collection-revival-theme", theme!);
        localStorage.setItem("collection-revival-achievements", achievements!);
      }, { key: STORAGE_KEY, state: originalState, theme: originalTheme, achievements: originalAchievements });
      await page.reload();
    }

    await page.evaluate(() => {
      localStorage.setItem("developerMode", "true");
      localStorage.setItem("collection-revival-system:qa-write-test", "internal-only");
      localStorage.setItem("collection-revival-real-user-tests:v1", "internal-only");
      localStorage.setItem("collection-revival-extension-test-state", "internal-only");
    });
    await page.goto("/settings/data-migration");
    await page.getByTestId("activation-preflight-idle").getByRole("button", { name: "检查启用条件" }).click();
    await expect(page.getByTestId("activation-preflight-passed")).toBeVisible({ timeout: 60_000 });
  });

  test("representative corrupt and unsupported bootstrap evidence opens Recovery without fallback", async ({ page }) => {
    const cases = [
      "{broken-marker",
      JSON.stringify({ version: 99, revision: 1, state: "legacy_active", activeBackend: "localStorage", updatedAt: "2026-07-19T08:00:00.000Z" }),
      JSON.stringify({ version: 1, revision: 2, state: "activating", activeBackend: "indexedDB", migrationId: "missing", activationId: "missing", journalId: "storage-activation:missing", databaseName: TASK8E_DATABASE_NAME, schemaVersion: 1, sourceRawChecksum: "a".repeat(64), sourceNormalizedChecksum: "b".repeat(64), targetRuntimeChecksum: "c".repeat(64), preparedAt: "2026-07-19T08:00:00.000Z", activatingAt: "2026-07-19T08:00:00.000Z", updatedAt: "2026-07-19T08:00:00.000Z" })
    ];
    for (let index = 0; index < cases.length; index += 1) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: TASK8E_MARKER_KEY, value: cases[index] });
      await page.goto("/");
      await expect(page.getByTestId("storage-recovery-screen")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(".app-shell")).toHaveCount(0);
      await expect(page.getByTestId("storage-recovery-screen")).toContainText("不会静默切回旧存储");
      if (index === 0) await captureTask8e(page, "recovery-corrupt-marker");
    }
  });
});

test.describe("Task 8E physical Chromium scale", () => {
  for (const itemCount of [3_000, 10_000]) {
    test(`${itemCount.toLocaleString()} records complete migration, activation, refresh and search`, async ({ page }) => {
      test.slow();
      test.setTimeout(itemCount === 10_000 ? 600_000 : 420_000);
      const timings: Record<string, number> = {};
      await page.goto("/");
      await deleteTask8eDatabase(page);
      await page.evaluate((key) => localStorage.removeItem(key), TASK8E_MARKER_KEY);
      await seedCompactLegacyFixture(page, itemCount);

      let started = Date.now();
      await page.goto("/dashboard");
      await expect(page.locator(".app-shell")).toBeVisible({ timeout: 120_000 });
      timings.legacyBootMs = Date.now() - started;

      started = Date.now();
      await runMigrationToCompleted(page);
      timings.migrationMs = Date.now() - started;
      expect((await readTask8eRecords(page, "savedItems")).length).toBe(itemCount);

      started = Date.now();
      await prepareActivation(page);
      timings.preflightAndPrepareMs = Date.now() - started;
      started = Date.now();
      await activatePreparedStorage(page);
      timings.activationBootMs = Date.now() - started;
      expect((await readTask8eRecords(page, "savedItems")).length).toBe(itemCount);

      started = Date.now();
      await page.reload();
      await expect(page.locator(".app-shell")).toBeVisible({ timeout: 180_000 });
      timings.refreshBootMs = Date.now() - started;
      await page.goto(`/search?q=${itemCount}`);
      await expect(page.getByPlaceholder("试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具")).toHaveValue(String(itemCount));
      expect(await readTask8eMarker(page)).toMatchObject({ state: "indexeddb_active" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
      await captureTask8e(page, `physical-${itemCount}-active`);
      console.info(`[Task8E ${itemCount}] ${JSON.stringify(timings)}`);
      await page.evaluate((key) => localStorage.removeItem(key), TASK8E_MARKER_KEY);
      await page.reload();
      await deleteTask8eDatabase(page);
    });
  }
});

