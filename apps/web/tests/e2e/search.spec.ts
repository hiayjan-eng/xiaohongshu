import { expect, test } from "@playwright/test";
import {
  collectConsoleErrors,
  expectNoConsoleErrors,
  getOpenedUrls,
  importTestNote,
  installWindowOpenSpy,
  readAchievements,
  readAppState,
  resetDemoData
} from "./helpers";

async function runSearch(page: import("@playwright/test").Page, query: string) {
  await page.goto("/search");
  await page.getByPlaceholder("试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具").fill(query);
  await page.locator(".search-page-form").getByRole("button", { name: "找回" }).click();
  const cards = page.getByTestId("search-result-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().locator(".reason-list span").first()).toContainText("命中");
  await expect(cards.first().getByTestId("open-source-search")).toBeVisible();
  await expect(cards.first().getByTestId("view-action-card")).toBeVisible();
  return cards.first();
}

test.describe("MVP search recall", () => {
  test("finds saved items by key terms and shows match reasons", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await installWindowOpenSpy(page);
    await resetDemoData(page);
    await importTestNote(page);

    for (const query of ["封面", "小红书", "设计", "大理", "低卡晚餐", "剪辑"]) {
      await runSearch(page, query);
    }

    await expectNoConsoleErrors(errors);
  });

  test("opens action card from search results and records search-to-open achievement once", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await installWindowOpenSpy(page);
    await resetDemoData(page);
    await importTestNote(page);

    const card = await runSearch(page, "封面");
    await card.getByTestId("view-action-card").click();
    await expect(page.getByTestId("view-action-card").first()).toBeVisible();
    await expect(page.locator(".detail-title-input")).toBeVisible();

    await runSearch(page, "封面");
    await page.getByTestId("search-result-card").first().getByTestId("open-source-search").click();
    await expect.poll(async () => (await getOpenedUrls(page)).length).toBeGreaterThan(0);
    expect((await getOpenedUrls(page))[0]).toContain("xiaohongshu.com");

    await expect.poll(async () => {
      const achievements = await readAchievements(page);
      return Boolean(achievements.search_recall);
    }).toBe(true);

    const firstUnlock = (await readAchievements(page)).search_recall;
    const closeAchievement = page.getByLabel("关闭成就提示");
    if (await closeAchievement.isVisible()) {
      await closeAchievement.click();
    }
    await page.getByTestId("search-result-card").first().getByTestId("open-source-search").click();
    await expect.poll(async () => (await getOpenedUrls(page)).length).toBeGreaterThanOrEqual(2);
    const secondUnlock = (await readAchievements(page)).search_recall;
    expect(secondUnlock).toBe(firstUnlock);

    const state = await readAppState(page);
    expect(state.searchLogs.some((log) => log.clickedSavedItemId)).toBe(true);
    await expectNoConsoleErrors(errors);
  });
});


