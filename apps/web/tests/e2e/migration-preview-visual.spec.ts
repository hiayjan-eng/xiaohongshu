import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { STORAGE_KEY } from "./helpers";
import { seedMigrationFixture } from "./migration-preview-fixtures";

const screenshotDirectory = path.resolve(process.cwd(), "test-results/task7a-migration-preview");

test.beforeAll(() => mkdirSync(screenshotDirectory, { recursive: true }));

test("captures Task 7A desktop acceptance states", async ({ page }) => {
  await seedMigrationFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings/data-migration");
  await expect(page.getByTestId("migration-inspection-step")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-initial.png"), fullPage: true });

  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByRole("heading", { name: "当前数据可以安全升级" })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-preview.png"), fullPage: true });

  await page.getByTestId("open-backup-step").click();
  await expect(page.getByTestId("migration-backup-step")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-backup.png"), fullPage: true });
});

test("captures Task 7A desktop review state", async ({ page }) => {
  await seedMigrationFixture(page, { duplicateSource: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings/data-migration");
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByRole("heading", { name: "有部分数据需要先确认" })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "desktop-1440-review-required.png"), fullPage: true });
});

test("captures Task 7A mobile initial and preview states", async ({ page }) => {
  await seedMigrationFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/data-migration");
  await expect(page.getByTestId("start-migration-inspection")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-initial.png"), fullPage: true });
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByTestId("migration-preview-step")).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-preview.png"), fullPage: true });
});

test("captures Task 7A mobile blocked state", async ({ page }) => {
  await seedMigrationFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/data-migration");
  await page.evaluate((key) => window.localStorage.setItem(key, "{broken-json"), STORAGE_KEY);
  await page.getByTestId("start-migration-inspection").click();
  await expect(page.getByRole("heading", { name: "当前数据还不能安全升级" })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDirectory, "mobile-390-blocked.png"), fullPage: true });
});
