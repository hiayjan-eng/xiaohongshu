import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { seedMigrationFixture } from "./migration-preview-fixtures";

const screenshotDirectory = path.resolve(process.cwd(), "test-results/task7b-migration-execution");
const databaseName = "collection-revival-local";
const stores = [
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

test.beforeAll(() => mkdirSync(screenshotDirectory, { recursive: true }));

test("captures desktop confirmation, real progress, verification, and completed-not-activated", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMigrationFixture(page, { itemCount: 3000 });
  await page.goto("/settings/data-migration");
  await reachConfirmation(page);
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-confirmation.png"), fullPage: true });

  await checkConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "35", { timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-progress-35.png"), fullPage: true });
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "95", { timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-final-verification.png"), fullPage: true });
  await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-completed-not-activated.png"), fullPage: true });
});

test("captures desktop execution failure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMigrationFixture(page);
  await page.goto("/settings/data-migration");
  await createMalformedTarget(page);
  await reachConfirmation(page);
  await checkConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-execution-failed")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-execution-failed.png"), fullPage: true });
});

test("captures desktop safely cancelled state", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMigrationFixture(page, { itemCount: 3000 });
  await page.goto("/settings/data-migration");
  await reachConfirmation(page);
  await checkConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-current-store")).toContainText(/收藏|导入明细/, { timeout: 30_000 });
  await page.getByRole("button", { name: "安全停止" }).click();
  await page.getByRole("dialog", { name: "安全停止升级？" }).getByRole("button", { name: "安全停止" }).click();
  await expect(page.getByTestId("migration-cancelled")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-cancelled.png"), fullPage: true });
});

test("captures mobile confirmation, progress, and completed-not-activated", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMigrationFixture(page, { itemCount: 3000 });
  await page.goto("/settings/data-migration");
  await reachConfirmation(page);
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-confirmation.png"), fullPage: true });
  await checkConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-current-store")).toContainText("导入明细", { timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-progress.png"), fullPage: true });
  await expect(page.getByTestId("migration-completed-not-activated")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-completed-not-activated.png"), fullPage: true });
});

test("captures mobile execution failure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMigrationFixture(page);
  await page.goto("/settings/data-migration");
  await createMalformedTarget(page);
  await reachConfirmation(page);
  await checkConfirmations(page);
  await page.getByTestId("start-migration-execution").click();
  await expect(page.getByTestId("migration-execution-failed")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-execution-failed.png"), fullPage: true });
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

async function checkConfirmations(page: Page) {
  const checkboxes = page.locator("[data-testid=migration-confirmation-step] input[type=checkbox]");
  for (let index = 0; index < 4; index += 1) await checkboxes.nth(index).check();
}

async function createMalformedTarget(page: Page) {
  await page.evaluate(({ name, definitions }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const [store, keyPath] of definitions) {
        request.result.createObjectStore(store, { keyPath: store === "savedItems" ? "wrongKey" : keyPath });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  }), { name: databaseName, definitions: stores });
}
