import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAchievements, resetDemoData, reviveImportedItem } from "./helpers";

test.describe("MVP completion reward and achievements", () => {
  test("marks an on-demand action card as revived, updates stats, and unlocks first achievement once", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    const item = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/reward-on-demand",
      title: "AI工具日常工作流入门",
      rawShareText: "ChatGPT 提示词和自动化工作流教程，适合提升办公效率",
      userNote: "想先复现第一个案例"
    });
    await reviveImportedItem(page, item.id);

    await page.getByTestId("status-completed").click();
    await expect(page.locator(".toast")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("第一次复活");

    await page.getByLabel("关闭成就提示").click();
    const achievementsAfterFirstClick = await readAchievements(page);
    expect(achievementsAfterFirstClick.first_revival).toBeTruthy();

    await page.goto("/dashboard");
    await expect(page.getByTestId("stat-已复活总数")).toContainText("1 条");
    await expect(page.getByTestId("stat-本周复活")).toContainText("1 条");
    await expect(page.getByTestId("stat-复活值")).toContainText("+1");
    await expect(page.getByText("第一次复活")).toBeVisible();

    await page.goto("/detail");
    await page.getByTestId("status-completed").click();
    await page.goto("/dashboard");
    await expect(page.getByTestId("stat-已复活总数")).toContainText("1 条");
    await expect(page.getByTestId("stat-复活值")).toContainText("+1");

    const achievementsAfterSecondClick = await readAchievements(page);
    expect(achievementsAfterSecondClick.first_revival).toBe(achievementsAfterFirstClick.first_revival);
    await expectNoConsoleErrors(errors);
  });
});