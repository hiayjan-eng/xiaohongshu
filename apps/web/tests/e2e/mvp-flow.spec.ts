import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAppState, resetDemoData, STORAGE_KEY } from "./helpers";

const pages = [
  { path: "/", heading: "别让收藏夹替你努力" },
  { path: "/dashboard", heading: "今天，从一条收藏开始" },
  { path: "/import", heading: "先导入一条真实收藏" },
  { path: "/albums", heading: "智能专辑" },
  { path: "/old-import", heading: "把旧收藏先整理成专辑" },
  { path: "/search", heading: "找回你收藏过的那一条" },
  { path: "/settings", heading: "本地 MVP 设置" },
  { path: "/qa", heading: "7 天稳定性检查面板" },
  { path: "/real-test", heading: "真实试用模式" }
];

test.describe("MVP page health and import flow", () => {
  for (const entry of pages) {
    test(`opens ${entry.path} without a blank screen`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto(entry.path);
      await expect(page.getByRole("heading", { name: entry.heading })).toBeVisible();
      await expect(page.locator("body")).not.toHaveText("");
      await expectNoConsoleErrors(errors);
    });
  }

  test("QA panel resets and imports demo seed data", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    let state = await readAppState(page);
    expect(state.savedItems.length).toBeGreaterThanOrEqual(20);
    expect(state.actionCards.length).toBeGreaterThanOrEqual(20);
    await expect(page.getByText("SavedItem")).toBeVisible();
    await expect(page.getByText("ActionCard")).toBeVisible();
    await expect(page.getByText("今日推荐")).toBeVisible();
    await expect(page.getByText("当前主题")).toBeVisible();

    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({
        user: {
          id: "user_local_001",
          name: "本地用户",
          email: "local@revival.app",
          createdAt: "2026-07-06T00:00:00.000Z"
        },
        savedItems: [],
        actionCards: [],
        searchLogs: [],
        smartAlbums: [],
        importBatches: [],
        importBatchItems: []
      }));
    }, STORAGE_KEY);
    await page.reload();
    await page.getByTestId("qa-import-demo").click();
    await expect.poll(async () => (await readAppState(page)).savedItems.length).toBeGreaterThanOrEqual(20);
    state = await readAppState(page);
    expect(state.actionCards.length).toBeGreaterThanOrEqual(20);
    await expectNoConsoleErrors(errors);
  });

  test("imports a new Xiaohongshu share and persists searchable action-card data", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    const item = await importTestNote(page);
    const state = await readAppState(page);
    const savedItem = state.savedItems.find((entry) => entry.id === item.id);
    const actionCard = state.actionCards.find((card) => card.savedItemId === item.id);

    expect(savedItem?.sourceUrl).toBe("https://www.xiaohongshu.com/explore/test-revival-note");
    expect(savedItem?.title).toBe("小红书封面设计技巧");
    expect(savedItem?.rawShareText).toContain("封面设计教程");
    expect(savedItem?.userNote).toContain("震海会");
    expect(savedItem?.category).toBeTruthy();
    expect(savedItem?.summary).toContain("行动卡");
    expect(savedItem?.keywords.length).toBeGreaterThan(0);
    expect(savedItem?.entities.length).toBeGreaterThan(0);
    expect(savedItem?.searchableText).toContain("封面");
    expect(actionCard?.nextAction).toBeTruthy();
    expect(actionCard?.tasks.length).toBeGreaterThan(0);
    expect(state.importBatches?.[0]?.source).toBe("manual_single");
    expect(state.importBatches?.[0]?.importedCount).toBe(1);
    expect(state.importBatchItems?.[0]?.status).toBe("imported");

    await page.goto("/pool");
    await page.getByPlaceholder("筛选收藏池").fill("封面设计");
    await expect(page.getByTestId("saved-item-card").filter({ hasText: "小红书封面设计技巧" })).toBeVisible();
    await expectNoConsoleErrors(errors);
  });
});

