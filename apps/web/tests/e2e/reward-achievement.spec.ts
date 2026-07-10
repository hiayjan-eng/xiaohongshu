import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, readAchievements, resetDemoData } from "./helpers";

test.describe("MVP completion reward and achievements", () => {
  test("marks an action card as revived, updates stats, and unlocks first achievement once", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    await page.goto("/pool");
    const card = page.getByTestId("saved-item-card").filter({ hasText: "剪映新手" });
    await expect(card).toBeVisible();
    await card.getByTestId("status-completed").click();

    await expect(card).toContainText("已复活");
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

    await page.goto("/pool");
    const completedCard = page.getByTestId("saved-item-card").filter({ hasText: "剪映新手" });
    await completedCard.getByTestId("status-completed").click();
    await page.goto("/dashboard");
    await expect(page.getByTestId("stat-已复活总数")).toContainText("1 条");
    await expect(page.getByTestId("stat-复活值")).toContainText("+1");

    const achievementsAfterSecondClick = await readAchievements(page);
    expect(achievementsAfterSecondClick.first_revival).toBe(achievementsAfterFirstClick.first_revival);
    await expectNoConsoleErrors(errors);
  });
});
