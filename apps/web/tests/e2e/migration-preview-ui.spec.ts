import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, STORAGE_KEY } from "./helpers";
import {
  installTask7aBoundarySpies,
  readLocalStorageSnapshot,
  readTask7aBoundarySpies,
  seedMigrationFixture
} from "./migration-preview-fixtures";

test.describe("Task 7A read-only migration preview UI", () => {
  test("Settings entry opens the independent migration route", async ({ page }) => {
    await seedMigrationFixture(page);
    const errors = collectConsoleErrors(page);
    await page.goto("/settings");
    const entry = page.getByTestId("migration-settings-entry");
    await expect(entry).toContainText("升级本地数据存储");
    await expect(entry).toContainText("尚未检查当前数据");
    await expect(page.getByTestId("developer-tools-panel")).not.toContainText("升级本地数据存储");
    await entry.getByTestId("open-data-migration").click();
    await expect(page).toHaveURL(/\/settings\/data-migration$/);
    await expect(page.getByRole("heading", { name: "升级本地数据存储" })).toBeVisible();
    await expect(page.getByTestId("migration-inspection-step")).toBeVisible();
    await expectNoConsoleErrors(errors);
  });

  test("valid data shows summary and downloads the canonical raw backup", async ({ page }) => {
    await seedMigrationFixture(page);
    const errors = collectConsoleErrors(page);
    await page.goto("/settings/data-migration");
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByRole("heading", { name: "当前数据可以安全升级" })).toBeVisible();
    await expect(page.getByText("收藏", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("智能专辑", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("行动卡", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("计划卡", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("将完整保留", { exact: true })).toBeVisible();
    await expect(page.getByText("升级后重新生成", { exact: true })).toBeVisible();
    await expect(page.getByText("默认不迁移", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("PRIVATE_NOTE_SHOULD_NOT_RENDER");
    await expect(page.locator("body")).not.toContainText("private-test-token");

    await page.getByTestId("open-backup-step").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-legacy-backup").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^collection-revival-backup-\d{8}-\d{6}\.json$/);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const fs = await import("node:fs/promises");
    const parsed = JSON.parse(await fs.readFile(filePath!, "utf8"));
    expect(parsed.source).toBe("legacy-localStorage");
    expect(parsed.rawBackup.rawRecords[STORAGE_KEY]).toBeTruthy();
    await expect(page.getByTestId("backup-download-status")).toContainText("备份下载已触发");
    await expect(page.getByRole("button", { name: /开始升级/ })).toHaveCount(0);
    await expectNoConsoleErrors(errors);
  });

  test("warning and manual review are grouped without exposing private content", async ({ page }) => {
    await seedMigrationFixture(page, { duplicateSource: true });
    const errors = collectConsoleErrors(page);
    await page.goto("/settings/data-migration");
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByRole("heading", { name: "有部分数据需要先确认" })).toBeVisible();
    await expect(page.getByTestId("migration-review-groups")).toContainText("来源链接重复");
    await expect(page.getByText(/会阻止后续升级|建议先确认/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /开始升级/ })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("PRIVATE_NOTE_SHOULD_NOT_RENDER");
    await expect(page.locator("body")).not.toContainText("private-test-token");
    const issueDetails = page.getByTestId("migration-issue-NORMALIZED_URL_DUPLICATE");
    await expect(issueDetails).not.toHaveAttribute("open", "");
    await expect(issueDetails.locator(".migration-technical-details")).not.toHaveAttribute("open", "");
    await expectNoConsoleErrors(errors);
  });

  test("invalid AppState is blocked but the unchanged raw value can still download", async ({ page }) => {
    await seedMigrationFixture(page);
    const errors = collectConsoleErrors(page);
    await page.goto("/settings/data-migration");
    await page.evaluate((key) => window.localStorage.setItem(key, "{broken-json"), STORAGE_KEY);
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByRole("heading", { name: "当前数据还不能安全升级" })).toBeVisible();
    await expect(page.getByText("本地数据格式无法完整识别")).toBeVisible();
    await page.getByTestId("open-backup-step").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-legacy-backup").click();
    const download = await downloadPromise;
    const fs = await import("node:fs/promises");
    const parsed = JSON.parse(await fs.readFile((await download.path())!, "utf8"));
    expect(parsed.rawBackup.rawRecords[STORAGE_KEY]).toBe("{broken-json");
    expect(parsed.normalizedSnapshot).toBeUndefined();
    await expect(page.locator("body")).not.toContainText("SyntaxError");
    await expectNoConsoleErrors(errors);
  });

  test("missing AppState shows the no-data path and never seeds demo data", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByTestId("migration-empty-state")).toContainText("当前没有找到可升级的收藏数据");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await page.getByRole("button", { name: "返回扫描与导入" }).click();
    await expect(page).toHaveURL(/\/import$/);
  });

  test("inspection and download add no writes, IndexedDB opens, Web Locks, or uploads", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await expect(page.getByTestId("migration-inspection-step")).toBeVisible();
    const before = await readLocalStorageSnapshot(page);
    await installTask7aBoundarySpies(page);
    const nonGetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") nonGetRequests.push(`${request.method()} ${request.url()}`);
    });

    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByTestId("migration-preview-step")).toBeVisible();
    await page.getByTestId("open-backup-step").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-legacy-backup").click();
    await downloadPromise;

    expect(await readTask7aBoundarySpies(page)).toEqual({
      setItemCalls: 0,
      removeItemCalls: 0,
      clearCalls: 0,
      indexedDbOpenCalls: 0
    });
    expect(await readLocalStorageSnapshot(page)).toEqual(before);
    expect(nonGetRequests).toEqual([]);
    expect(await page.evaluate(() => "locks" in navigator ? 0 : 0)).toBe(0);
  });

  test("refresh discards the in-memory inspection result", async ({ page }) => {
    await seedMigrationFixture(page);
    await page.goto("/settings/data-migration");
    await page.getByTestId("start-migration-inspection").click();
    await expect(page.getByTestId("migration-preview-step")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("migration-inspection-step")).toBeVisible();
    await expect(page.getByText("检查结果只保留在当前页面")).toBeVisible();
  });
});
