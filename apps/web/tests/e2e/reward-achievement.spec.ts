import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAchievements, readAppState, resetDemoData, reviveImportedItem } from "./helpers";

test.describe("MVP completion reward and achievements", () => {
  test("completes only after start, persists output, and unlocks the first achievement once", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    const item = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/reward-on-demand",
      title: "AI工具日常工作流入门",
      rawShareText: "ChatGPT 提示词和自动化工作流教程，适合提升办公效率",
      userNote: "想先复现第一个案例"
    });
    await reviveImportedItem(page, item.id);

    await expect(page.getByTestId("status-completed")).toHaveCount(0);
    await page.getByTestId("add-to-today").click();
    await page.getByTestId("start-action").click();
    await page.getByTestId("action-output-field").locator("textarea").fill("完成一张 AI 测试图和四步操作清单");
    await page.getByTestId("save-action-output").click();
    await page.getByTestId("status-completed").click();
    await expect(page.getByRole("dialog")).toContainText("第一次复活");

    await page.getByLabel("关闭成就提示").click();
    const achievementsAfterFirstCompletion = await readAchievements(page);
    expect(achievementsAfterFirstCompletion.first_revival).toBeTruthy();

    let state = await readAppState(page);
    const card = state.actionCards.find((entry) => entry.savedItemId === item.id);
    expect(state.savedItems.find((entry) => entry.id === item.id)?.status).toBe("completed");
    expect(card?.fields["复活产出/备注"]).toContain("四步操作清单");
    expect(card?.outputSavedAt).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("completed-action-summary")).toContainText("四步操作清单");
    await page.getByTestId("undo-completed").click();
    await page.getByTestId("status-completed").click();
    await expect(page.getByLabel("关闭成就提示")).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByTestId("stat-已复活总数")).toContainText("1 条");
    await expect(page.getByTestId("stat-本周复活")).toContainText("1 条");
    await expect(page.getByTestId("stat-复活值")).toContainText("+1");
    await expect(page.getByText("第一次复活")).toBeVisible();

    state = await readAppState(page);
    expect(state.planCards?.filter((plan) => plan.savedItemId === item.id)).toHaveLength(1);
    const achievementsAfterSecondCompletion = await readAchievements(page);
    expect(achievementsAfterSecondCompletion.first_revival).toBe(achievementsAfterFirstCompletion.first_revival);
    await expectNoConsoleErrors(errors);
  });
});