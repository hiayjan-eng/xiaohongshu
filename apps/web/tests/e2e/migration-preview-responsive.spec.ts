import { expect, test } from "@playwright/test";
import { seedMigrationFixture } from "./migration-preview-fixtures";

for (const viewport of [
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile-360", width: 360, height: 800 }
]) {
  test(`Task 7A remains usable at ${viewport.name}`, async ({ page }) => {
    await seedMigrationFixture(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/settings/data-migration");
    await expect(page.getByRole("heading", { name: "升级本地数据存储" })).toBeVisible();
    await expect(page.getByTestId("start-migration-inspection")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByTestId("migration-preview-step")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    await page.getByTestId("open-backup-step").click();
    await expect(page.getByTestId("download-legacy-backup")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  });
}
