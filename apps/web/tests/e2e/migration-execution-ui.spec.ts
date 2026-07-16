import { expect, test, type Page } from "@playwright/test";
import { MIGRATION_WRITER_LOCK_NAME } from "@revival/storage-service";
import { collectConsoleErrors, expectNoConsoleErrors } from "./helpers";
import {
  installTask7aBoundarySpies,
  readLocalStorageSnapshot,
  readTask7aBoundarySpies,
  seedMigrationFixture
} from "./migration-preview-fixtures";

const DATABASE_NAME = "collection-revival-local";
const STORE_DEFINITIONS = [
  ["savedItems", "id"],
  ["importBatches", "id"],
  ["importBatchItems", "id"],
  ["smartAlbums", "id"],
  ["actionCards", "id"],
  ["planCards", "id"],
  ["classificationCorrections", "id"],
  ["searchLogs", "id"],
  ["settings", "key"],
  ["migrationMetadata", "id"],
  ["backups", "id"]
] as const;

test.describe("Task 7B migration execution UI", () => {
  test("confirmed data migrates into IndexedDB but remains completed-not-activated", async ({ page }) => {
    await seedMigrationFixture(page);
    const errors = collectConsoleErrors(page);
    await page.goto("/settings/data-migration");
    const before = await readLocalStorageSnapshot(page);
    await installTask7aBoundarySpies(page);

    await reachConfirmation(page);
    await checkAllConfirmations(page);
    await page.getByTestId("start-migration-execution").click();

    const completed = page.getByTestId("migration-completed-not-activated");
    await expect(completed).toBeVisible({ timeout: 30_000 });
    await expect(completed).toContainText("本地数据升级完成");
    await expect(completed).toContainText("旧本地存储");
    await expect(completed).toContainText("已准备，尚未启用");
    await expect(completed).toContainText("仍然保留");
    await expect(completed.getByRole("button", { name: /启用|切换|删除/ })).toHaveCount(0);

    const counts = await readIndexedDbCounts(page);
    expect(counts.savedItems).toBe(1);
    expect(counts.importBatches).toBe(1);
    expect(counts.importBatchItems).toBe(1);
    expect(counts.smartAlbums).toBe(1);
    expect(counts.actionCards).toBe(1);
    expect(counts.planCards).toBe(1);
    expect(counts.classificationCorrections).toBe(1);
    expect(counts.backups).toBe(1);
    expect(counts.migrationMetadata).toBe(1);
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
    const boundary = await readTask7aBoundarySpies(page);
    expect(boundary.setItemCalls).toBe(0);
    expect(boundary.removeItemCalls).toBe(0);
    expect(boundary.clearCalls).toBe(0);
    expect(boundary.indexedDbOpenCalls).toBeGreaterThanOrEqual(1);
    await expectNoConsoleErrors(errors);
  });

  test("backup and four explicit confirmations gate the first IndexedDB open", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await installTask7aBoundarySpies(page);
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByTestId("migration-preview-step")).toBeVisible();
    await page.getByTestId("open-backup-step").click();
    await expect(page.getByTestId("continue-to-migration-confirmation")).toBeDisabled();
    expect((await readTask7aBoundarySpies(page)).indexedDbOpenCalls).toBe(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-legacy-backup").click();
    await downloadPromise;
    await page.getByTestId("continue-to-migration-confirmation").click();
    const start = page.getByTestId("start-migration-execution");
    await expect(start).toBeDisabled();
    const confirmations = page.locator("[data-testid=migration-confirmation-step] input[type=checkbox]");
    await confirmations.nth(0).check();
    await confirmations.nth(1).check();
    await confirmations.nth(2).check();
    await expect(start).toBeDisabled();
    expect((await readTask7aBoundarySpies(page)).indexedDbOpenCalls).toBe(0);
    await confirmations.nth(3).check();
    await expect(start).toBeEnabled();
    expect((await readTask7aBoundarySpies(page)).indexedDbOpenCalls).toBe(0);
  });

  test("missing Web Locks fails safely before creating IndexedDB", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "locks", { configurable: true, get: () => undefined });
    });
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    const before = await readLocalStorageSnapshot(page);
    await installTask7aBoundarySpies(page);
    await reachConfirmation(page);
    await checkAllConfirmations(page);
    await page.getByTestId("start-migration-execution").click();

    const failed = page.getByTestId("migration-execution-failed");
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("安全升级锁");
    expect(await readTask7aBoundarySpies(page)).toEqual({
      setItemCalls: 0,
      removeItemCalls: 0,
      clearCalls: 0,
      indexedDbOpenCalls: 0
    });
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
  });

  test("a non-empty target is never overwritten", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await createNonEmptyTarget(page);
    const before = await readLocalStorageSnapshot(page);
    await reachConfirmation(page);
    await checkAllConfirmations(page);
    await page.getByTestId("start-migration-execution").click();

    const failed = page.getByTestId("migration-execution-failed");
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("新存储中已经存在其他数据");
    const existing = await readStoreRecords(page, "savedItems");
    expect(existing).toEqual([{ id: "existing-target-record", title: "do not overwrite" }]);
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
  });

  test("an existing writer lock blocks execution without a process-local fallback", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await holdMigrationWriterLock(page);
    await reachConfirmation(page);
    await checkAllConfirmations(page);
    await page.getByTestId("start-migration-execution").click();

    const failed = page.getByTestId("migration-execution-failed");
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("安全升级锁");
    const counts = await readIndexedDbCounts(page);
    expect(counts.backups).toBe(0);
    expect(counts.migrationMetadata).toBe(0);
    expect(counts.savedItems).toBe(0);
    await releaseMigrationWriterLock(page);
  });

  test("safe stop leaves no half-written Store and never activates the target", async ({ page }) => {
    test.slow();
    await seedMigrationFixture(page, { itemCount: 3000 });
    await page.goto("/settings/data-migration");
    const before = await readLocalStorageSnapshot(page);
    await reachConfirmation(page);
    await checkAllConfirmations(page);
    await page.getByTestId("start-migration-execution").click();
    await expect(page.getByTestId("migration-execution-step")).toBeVisible();
    await expect(page.getByTestId("migration-current-store")).toContainText(/收藏|导入明细/, { timeout: 30_000 });
    await page.getByRole("button", { name: "安全停止" }).click();
    const dialog = page.getByRole("dialog", { name: "安全停止升级？" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "安全停止" }).click();

    const cancelled = page.getByTestId("migration-cancelled");
    await expect(cancelled).toBeVisible({ timeout: 30_000 });
    await expect(cancelled).toContainText("当前使用：旧本地存储");
    await expect(cancelled.getByRole("button", { name: /继续升级|恢复|启用/ })).toHaveCount(0);
    const counts = await readIndexedDbCounts(page);
    expect([0, 3000]).toContain(counts.savedItems);
    expect([0, 3000]).toContain(counts.importBatchItems);
    expect(counts.backups).toBe(1);
    expect(counts.migrationMetadata).toBe(1);
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
  });

  test("mobile confirmation and completion have no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await reachConfirmation(page);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await expect(page.getByTestId("start-migration-execution")).toBeVisible();
    await checkAllConfirmations(page);
    await page.getByTestId("start-migration-execution").click();
    await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 30_000 });
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

async function reachConfirmation(page: Page) {
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByTestId("migration-preview-step")).toBeVisible();
  await page.getByTestId("open-backup-step").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-legacy-backup").click();
  await downloadPromise;
  await page.getByTestId("continue-to-migration-confirmation").click();
  await expect(page.getByTestId("migration-confirmation-step")).toBeVisible();
}

async function checkAllConfirmations(page: Page) {
  const confirmations = page.locator("[data-testid=migration-confirmation-step] input[type=checkbox]");
  await expect(confirmations).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await confirmations.nth(index).check();
  await expect(page.getByTestId("start-migration-execution")).toBeEnabled();
}

async function createNonEmptyTarget(page: Page) {
  await page.evaluate(({ databaseName, stores }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of stores) request.result.createObjectStore(name, { keyPath });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("savedItems", "readwrite");
      transaction.objectStore("savedItems").add({ id: "existing-target-record", title: "do not overwrite" });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { databaseName: DATABASE_NAME, stores: STORE_DEFINITIONS });
}

async function readIndexedDbCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(({ databaseName, stores }) => new Promise<Record<string, number>>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const database = request.result;
      try {
        const output: Record<string, number> = {};
        for (const [name] of stores) {
          output[name] = database.objectStoreNames.contains(name)
            ? await new Promise<number>((countResolve, countReject) => {
                const transaction = database.transaction(name, "readonly");
                const count = transaction.objectStore(name).count();
                count.onsuccess = () => countResolve(count.result);
                count.onerror = () => countReject(count.error);
              })
            : 0;
        }
        database.close();
        resolve(output);
      } catch (error) {
        database.close();
        reject(error);
      }
    };
  }), { databaseName: DATABASE_NAME, stores: STORE_DEFINITIONS });
}

async function readStoreRecords(page: Page, storeName: string): Promise<unknown[]> {
  return page.evaluate(({ databaseName, storeName }) => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readonly");
      const records = transaction.objectStore(storeName).getAll();
      records.onsuccess = () => {
        database.close();
        resolve(records.result);
      };
      records.onerror = () => reject(records.error);
    };
  }), { databaseName: DATABASE_NAME, storeName });
}

async function holdMigrationWriterLock(page: Page) {
  await page.evaluate((lockName) => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const lockRequest = navigator.locks.request(lockName, { mode: "exclusive" }, async () => {
      acquired();
      await released;
    });
    Object.assign(window, { __task7bLockReady: ready, __task7bLockRelease: release, __task7bLockRequest: lockRequest });
  }, MIGRATION_WRITER_LOCK_NAME);
  await page.evaluate(() => (window as Window & { __task7bLockReady: Promise<void> }).__task7bLockReady);
}

async function releaseMigrationWriterLock(page: Page) {
  await page.evaluate(async () => {
    const state = window as Window & { __task7bLockRelease: () => void; __task7bLockRequest: Promise<void> };
    state.__task7bLockRelease();
    await state.__task7bLockRequest;
  });
}

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
