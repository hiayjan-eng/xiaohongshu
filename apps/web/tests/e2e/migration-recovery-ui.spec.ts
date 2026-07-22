import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { MIGRATION_WRITER_LOCK_NAME } from "@revival/storage-service";
import { collectConsoleErrors, expectNoConsoleErrors } from "./helpers";
import { readLocalStorageSnapshot, seedMigrationFixture } from "./migration-preview-fixtures";

const DATABASE_NAME = "collection-revival-local";
const BUSINESS_STORES = ["savedItems", "importBatches", "importBatchItems", "smartAlbums", "actionCards", "planCards", "classificationCorrections", "searchLogs", "settings"];

test.describe("Task 7C migration recovery UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await deleteDatabase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteDatabase(page);
  });

  test("completed migration survives refresh, reports safely, and rolls back without deleting evidence", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    const before = await readLocalStorageSnapshot(page);
    await completeMigration(page);
    await page.reload();
    const completed = page.getByTestId("migration-completed-not-activated");
    await expect(completed).toBeVisible();
    await expect(completed).toContainText("尚未启用");
    await expect(completed.getByRole("button", { name: /立即启用|删除旧/ })).toHaveCount(0);

    await completed.getByRole("button", { name: "升级报告" }).click();
    await expect(page.getByTestId("migration-recovery-report")).toContainText("旧本地存储");
    const reportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载迁移报告" }).click();
    const report = await reportDownload;
    expect(report.suggestedFilename()).toMatch(/^collection-revival-migration-report-/);
    const reportText = await readDownload(report);
    expect(() => JSON.parse(reportText)).not.toThrow();
    expect(reportText).not.toContain("userNote");
    expect(reportText).not.toContain("serializedEnvelope");
    expect(reportText).not.toContain("expectedChecksum");

    await completed.getByRole("button", { name: "恢复到升级前" }).click();
    await confirmRollback(page);
    await expect(page.getByTestId("migration-recovery-rolled_back")).toBeVisible({ timeout: 30_000 });
    const counts = await readCounts(page, [...BUSINESS_STORES, "backups", "migrationMetadata"]);
    for (const store of BUSINESS_STORES) expect(counts[store]).toBe(0);
    expect(counts.backups).toBe(1);
    expect(counts.migrationMetadata).toBe(1);
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem("collection-revival-active-storage"))).toBeNull();
    await page.reload();
    await expect(page.getByTestId("migration-recovery-rolled_back")).toBeVisible();
  });

  test("cancelled migration is discovered after refresh and resumes from persisted backup", async ({ page }) => {
    test.setTimeout(90_000);
    await seedMigrationFixture(page, { itemCount: 3000 });
    await page.goto("/settings/data-migration");
    const before = await readLocalStorageSnapshot(page);
    await cancelMigration(page);
    await page.reload();
    const recovery = page.getByTestId("migration-recovery-resume_available");
    await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "继续升级" }).click();
    const confirmation = page.getByTestId("migration-resume-confirmation");
    await confirmation.getByRole("checkbox").check();
    await confirmation.getByRole("button", { name: "继续升级" }).click();
    await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 45_000 });
    const metadata = await readRecords(page, "migrationMetadata") as Array<{ resumeCount?: number }>;
    expect(metadata[0]?.resumeCount).toBeGreaterThan(0);
    expect((await readCounts(page, ["savedItems"])).savedItems).toBe(3000);
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
  });

  test("resume conflict blocks continuation without automatically clearing target data", async ({ page, context }) => {
    test.setTimeout(90_000);
    await seedMigrationFixture(page, { itemCount: 3000 });
    await cancelMigration(page);
    const mutator = await context.newPage();
    await mutator.goto("/");
    await mutator.getByRole("button", { name: "进入工作台" }).click();
    await mutator.waitForLoadState("networkidle");
    await patchFirstRecord(mutator, "savedItems", { userNote: "synthetic conflict" });
    await mutator.close();
    const beforeCount = (await readCounts(page, ["savedItems"])).savedItems;
    await page.reload();
    await page.getByRole("button", { name: "继续升级" }).click();
    await page.getByTestId("migration-resume-confirmation").getByRole("checkbox").check();
    await page.getByTestId("migration-resume-confirmation").getByRole("button", { name: "继续升级" }).click();
    const blocked = page.getByTestId("migration-execution-failed");
    await expect(blocked).toBeVisible({ timeout: 30_000 });
    await expect(blocked).toContainText("不能自动继续");
    expect((await readCounts(page, ["savedItems"])).savedItems).toBe(beforeCount);
  });

  test("tampered stored backup disables Resume and backup download but leaves rollback available", async ({ page }) => {
    test.setTimeout(90_000);
    await seedMigrationFixture(page, { itemCount: 3000 });
    await cancelMigration(page);
    await mutateFirstRecord(page, "backups", (record) => ({ ...record, checksum: "0".repeat(64) }));
    await page.reload();
    const recovery = page.getByTestId("migration-recovery-rollback_available");
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("button", { name: "继续升级" })).toHaveCount(0);
    await expect(recovery.getByRole("button", { name: "重新下载原始备份" })).toHaveCount(0);
    await expect(recovery).toContainText("需要检查");
  });

  test("rollback_failed refresh offers an idempotent retry and keeps Backup and Metadata", async ({ page }) => {
    await seedMigrationFixture(page);
    await completeMigration(page);
    await mutateFirstRecord(page, "migrationMetadata", (record) => ({
      ...record,
      status: "failed",
      executionStatus: "rollback_failed",
      checkpoints: (record.checkpoints as Array<Record<string, unknown>>).map((checkpoint, index) => index === 0 ? { ...checkpoint, status: "rolled_back", writtenCount: 0, verifiedCount: 0 } : checkpoint)
    }));
    await clearStore(page, "settings");
    await page.reload();
    const failed = page.getByTestId("migration-recovery-rollback_failed");
    await expect(failed).toBeVisible();
    await failed.getByRole("button", { name: "继续恢复" }).click();
    await confirmRollback(page);
    await expect(page.getByTestId("migration-recovery-rolled_back")).toBeVisible({ timeout: 30_000 });
    const counts = await readCounts(page, ["backups", "migrationMetadata", ...BUSINESS_STORES]);
    expect(counts.backups).toBe(1);
    expect(counts.migrationMetadata).toBe(1);
    for (const store of BUSINESS_STORES) expect(counts[store]).toBe(0);
  });

  test("another tab holding the writer lock blocks recovery until status is refreshed", async ({ page, context }) => {
    test.setTimeout(90_000);
    await seedMigrationFixture(page, { itemCount: 3000 });
    await cancelMigration(page);
    const holder = await context.newPage();
    await holder.goto("/");
    await holdWriterLock(holder);
    await page.reload();
    await expect(page.getByTestId("migration-recovery-another_session_running")).toBeVisible();
    await expect(page.getByRole("heading", { name: "另一个页面正在处理这次升级" })).toBeVisible();
    await releaseWriterLock(holder);
    await holder.close();
    await page.getByRole("button", { name: "刷新状态" }).click();
    await expect(page.getByTestId("migration-recovery-resume_available")).toBeVisible();
  });

  test("a browser with no migration database stays in normal inspection without creating one", async ({ page }) => {
    const before = await listDatabaseNames(page);
    expect(before).not.toContain(DATABASE_NAME);
    await page.goto("/settings/data-migration");
    await expect(page.getByTestId("start-migration-inspection")).toBeVisible();
    const after = await listDatabaseNames(page);
    expect(after).not.toContain(DATABASE_NAME);
  });

  test("activeStorageSwitched and multiple unresolved metadata are blocked without cleanup", async ({ page }) => {
    await seedMigrationFixture(page);
    await completeMigration(page);
    await mutateFirstRecord(page, "migrationMetadata", (record) => ({ ...record, activeStorageSwitched: true }));
    await page.reload();
    await expect(page.getByTestId("migration-recovery-recovery_blocked")).toContainText("标记为启用");
    expect((await readCounts(page, ["savedItems"])).savedItems).toBe(1);

    await mutateFirstRecord(page, "migrationMetadata", (record) => ({ ...record, activeStorageSwitched: false }));
    const records = await readRecords(page, "migrationMetadata") as Array<Record<string, unknown>>;
    await addRecord(page, "migrationMetadata", { ...records[0], id: "migration-execution:second-unresolved", executionStatus: "failed", status: "failed" });
    await page.reload();
    await expect(page.getByTestId("migration-recovery-recovery_blocked")).toContainText("多条");
  });

  test("stored backup can be re-downloaded only after verification", async ({ page }) => {
    await seedMigrationFixture(page);
    await completeMigration(page);
    await page.reload();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "重新下载原始备份" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^collection-revival-backup-/);
    const content = await readDownload(download);
    const parsed = JSON.parse(content) as { source?: string; rawBackup?: unknown };
    expect(parsed.source).toBe("legacy-localStorage");
    expect(parsed.rawBackup).toBeTruthy();
  });

  test("mobile recovery and report remain readable without horizontal overflow", async ({ page }) => {
    await seedMigrationFixture(page);
    await completeMigration(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const completed = page.getByTestId("migration-completed-not-activated");
    await expect(completed).toBeVisible();
    await expect(completed).toContainText("尚未启用");
    await completed.getByRole("button", { name: "升级报告" }).click();
    await expect(page.getByTestId("migration-recovery-report")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    const buttons = completed.locator(".migration-recovery-actions button");
    for (let index = 0; index < await buttons.count(); index += 1) {
      const box = await buttons.nth(index).boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(358);
    }
  });

  test("recovery UI emits no console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedMigrationFixture(page);
    await completeMigration(page);
    await page.reload();
    await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible();
    await expectNoConsoleErrors(errors);
  });

  test("desktop visual acceptance covers Resume, Rollback, completed, rolled back, and report", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedMigrationFixture(page, { itemCount: 3000 });
    await cancelMigration(page);
    await page.reload();
    const resumeAvailable = page.getByTestId("migration-recovery-resume_available");
    await expect(resumeAvailable).toBeVisible();
    await captureTask7cScreenshot(page, "01-desktop-cancelled-migration.png");

    await resumeAvailable.getByRole("button", { name: "继续升级" }).click();
    await expect(page.getByTestId("migration-resume-confirmation")).toBeVisible();
    await captureTask7cScreenshot(page, "02-desktop-resume-confirmation.png");
    const resumeConfirmation = page.getByTestId("migration-resume-confirmation");
    await resumeConfirmation.getByRole("checkbox").check();
    await delayWebCryptoForVisualCapture(page);
    await resumeConfirmation.getByRole("button", { name: "继续升级" }).click();
    await expect(page.getByTestId("migration-resume-progress")).toBeVisible();
    await captureTask7cScreenshot(page, "03-desktop-resume-progress.png");

    const completed = page.getByTestId("migration-completed-not-activated");
    await expect(completed).toBeVisible({ timeout: 45_000 });
    await captureTask7cScreenshot(page, "06-desktop-completed-refresh.png");
    await completed.getByRole("button", { name: "升级报告" }).click();
    await expect(page.getByTestId("migration-recovery-report")).toBeVisible();
    await captureTask7cScreenshot(page, "09-desktop-migration-report.png");

    await completed.getByRole("button", { name: "恢复到升级前" }).click();
    await expect(page.getByTestId("migration-rollback-confirmation")).toBeVisible();
    await captureTask7cScreenshot(page, "04-desktop-rollback-confirmation.png");
    const rollbackConfirmation = page.getByTestId("migration-rollback-confirmation");
    await rollbackConfirmation.getByRole("checkbox").nth(0).check();
    await rollbackConfirmation.getByRole("checkbox").nth(1).check();
    await rollbackConfirmation.getByRole("button", { name: "确认恢复" }).click();
    await expect(page.getByTestId("migration-rollback-progress")).toBeVisible();
    await captureTask7cScreenshot(page, "05-desktop-rollback-progress.png");
    await expect(page.getByTestId("migration-recovery-rolled_back")).toBeVisible({ timeout: 30_000 });
    await captureTask7cScreenshot(page, "08-desktop-rolled-back.png");
  });

  test("rollback failed visual acceptance remains readable on desktop and mobile", async ({ page }) => {
    await seedMigrationFixture(page);
    await completeMigration(page);
    await mutateFirstRecord(page, "migrationMetadata", (record) => ({
      ...record,
      status: "failed",
      executionStatus: "rollback_failed",
      checkpoints: (record.checkpoints as Array<Record<string, unknown>>).map((checkpoint, index) => index === 0 ? { ...checkpoint, status: "rolled_back", writtenCount: 0, verifiedCount: 0 } : checkpoint)
    }));
    await clearStore(page, "settings");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.getByTestId("migration-recovery-rollback_failed")).toBeVisible();
    await captureTask7cScreenshot(page, "07-desktop-rollback-failed.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByTestId("migration-recovery-rollback_failed")).toBeVisible();
    await captureTask7cScreenshot(page, "14-mobile-rollback-failed.png");
  });

  test("mobile visual acceptance covers recovery confirmation, progress, completed, and report", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMigrationFixture(page, { itemCount: 3000 });
    await cancelMigration(page);
    await page.reload();
    const resumeAvailable = page.getByTestId("migration-recovery-resume_available");
    await expect(resumeAvailable).toBeVisible();
    await captureTask7cScreenshot(page, "10-mobile-resume-available.png");

    await resumeAvailable.getByRole("button", { name: "恢复到升级前" }).click();
    await expect(page.getByTestId("migration-rollback-confirmation")).toBeVisible();
    await captureTask7cScreenshot(page, "11-mobile-rollback-confirmation.png");
    await page.getByTestId("migration-rollback-confirmation").getByRole("button", { name: "暂不恢复" }).click();

    await page.getByTestId("migration-recovery-resume_available").getByRole("button", { name: "继续升级" }).click();
    const confirmation = page.getByTestId("migration-resume-confirmation");
    await confirmation.getByRole("checkbox").check();
    await delayWebCryptoForVisualCapture(page);
    await confirmation.getByRole("button", { name: "继续升级" }).click();
    await expect(page.getByTestId("migration-resume-progress")).toBeVisible();
    await captureTask7cScreenshot(page, "12-mobile-resume-progress.png");
    const completed = page.getByTestId("migration-completed-not-activated");
    await expect(completed).toBeVisible({ timeout: 45_000 });
    await captureTask7cScreenshot(page, "13-mobile-completed-not-activated.png");
    await completed.getByRole("button", { name: "升级报告" }).click();
    await expect(page.getByTestId("migration-recovery-report")).toBeVisible();
    await captureTask7cScreenshot(page, "15-mobile-migration-report.png");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
  });
});

async function completeMigration(page: Page) {
  await page.goto("/settings/data-migration");
  await reachConfirmation(page);
  await checkAllExecutionConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 30_000 });
}

async function cancelMigration(page: Page) {
  await page.goto("/settings/data-migration");
  await reachConfirmation(page);
  await checkAllExecutionConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  const execution = page.getByTestId("migration-execution-step");
  await expect(execution).toBeVisible();
  await expect(execution.locator(".migration-execution-metrics span").nth(1)).toContainText(/[1-8] \/ 9/, { timeout: 30_000 });
  await page.getByRole("button", { name: "安全停止" }).click();
  const dialog = page.getByRole("dialog", { name: "安全停止升级？" });
  await dialog.getByRole("button", { name: "安全停止" }).click();
  await expect(page.getByTestId("migration-cancelled")).toBeVisible({ timeout: 30_000 });
}

async function reachConfirmation(page: Page) {
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByTestId("migration-preview-step")).toBeVisible();
  await page.getByTestId("open-backup-step").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-legacy-backup").click();
  await downloadPromise;
  await page.getByTestId("continue-to-migration-confirmation").click();
}

async function checkAllExecutionConfirmations(page: Page) {
  const confirmation = page.getByTestId("migration-confirmation-step");
  const checkboxes = confirmation.getByRole("checkbox");
  for (let index = 0; index < await checkboxes.count(); index += 1) await checkboxes.nth(index).check();
}

async function confirmRollback(page: Page) {
  const confirmation = page.getByTestId("migration-rollback-confirmation");
  const checkboxes = confirmation.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await confirmation.getByRole("button", { name: "确认恢复" }).click();
}

async function listDatabaseNames(page: Page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
}

async function readCounts(page: Page, stores: string[]): Promise<Record<string, number>> {
  return page.evaluate(({ databaseName, stores }) => new Promise<Record<string, number>>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const database = request.result;
      const output: Record<string, number> = {};
      try {
        for (const store of stores) output[store] = await requestResult(database.transaction(store, "readonly").objectStore(store).count());
        database.close();
        resolve(output);
      } catch (error) {
        database.close();
        reject(error);
      }
    };
    function requestResult(count: IDBRequest<number>) { return new Promise<number>((done, fail) => { count.onsuccess = () => done(count.result); count.onerror = () => fail(count.error); }); }
  }), { databaseName: DATABASE_NAME, stores });
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

async function mutateFirstRecord(page: Page, storeName: string, mutate: (record: Record<string, unknown>) => Record<string, unknown>) {
  const records = await readRecords(page, storeName) as Array<Record<string, unknown>>;
  await putRecord(page, storeName, mutate(records[0]));
}

async function patchFirstRecord(page: Page, storeName: string, patch: Record<string, unknown>) {
  await page.evaluate(({ databaseName, storeName, patch }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readwrite");
      const cursorRequest = transaction.objectStore(storeName).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          transaction.abort();
          reject(new Error(`No record exists in ${storeName}.`));
          return;
        }
        cursor.update({ ...cursor.value, ...patch });
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("IndexedDB mutation was aborted.")); };
    };
  }), { databaseName: DATABASE_NAME, storeName, patch });
}

async function putRecord(page: Page, storeName: string, record: Record<string, unknown>) {
  await page.evaluate(({ databaseName, storeName, record }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { databaseName: DATABASE_NAME, storeName, record });
}

async function addRecord(page: Page, storeName: string, record: Record<string, unknown>) {
  await putRecord(page, storeName, record);
}

async function clearStore(page: Page, storeName: string) {
  await page.evaluate(({ databaseName, storeName }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).clear();
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { databaseName: DATABASE_NAME, storeName });
}

async function deleteDatabase(page: Page) {
  await page.evaluate((databaseName) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Task 7C test database deletion was blocked."));
  }), DATABASE_NAME);
}

async function holdWriterLock(page: Page) {
  await page.evaluate((lockName) => {
    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const request = navigator.locks.request(lockName, { mode: "exclusive" }, async () => { acquired(); await released; });
    Object.assign(window, { __task7cLockReady: ready, __task7cLockRelease: release, __task7cLockRequest: request });
  }, MIGRATION_WRITER_LOCK_NAME);
  await page.evaluate(() => (window as Window & { __task7cLockReady: Promise<void> }).__task7cLockReady);
}

async function releaseWriterLock(page: Page) {
  await page.evaluate(async () => {
    const state = window as Window & { __task7cLockRelease: () => void; __task7cLockRequest: Promise<void> };
    state.__task7cLockRelease();
    await state.__task7cLockRequest;
  });
}

async function readDownload(download: import("@playwright/test").Download): Promise<string> {
  return new TextDecoder().decode(await download.createReadStream().then(async (stream) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }));
}

async function captureTask7cScreenshot(page: Page, filename: string) {
  await page.screenshot({
    path: `test-results/task7c-migration-recovery/${filename}`,
    fullPage: false
  });
}

async function delayWebCryptoForVisualCapture(page: Page) {
  await page.evaluate(() => {
    const subtle = globalThis.crypto.subtle;
    const originalDigest = subtle.digest.bind(subtle);
    Object.defineProperty(subtle, "digest", {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto["digest"]>) => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        return originalDigest(...args);
      }
    });
  });
}
