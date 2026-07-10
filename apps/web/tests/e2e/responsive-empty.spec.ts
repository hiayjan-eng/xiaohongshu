import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, seedEmptyState } from "./helpers";

test.describe("MVP empty states and responsive basics", () => {
  test("handles empty local data and missing sourceUrl without crashing", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedEmptyState(page);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "今天，从一条收藏开始" })).toBeVisible();
    await expect(page.getByText("今天没有待复活收藏")).toBeVisible();
    await expect(page.getByText("收藏池还是空的")).toBeVisible();

    await page.goto("/pool");
    await expect(page.getByText("收藏池暂无内容")).toBeVisible();

    await page.goto("/search");
    await page.getByPlaceholder("试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具").fill("完全不存在的验收关键词");
    await page.locator(".search-page-form").getByRole("button", { name: "找回" }).click();
    await expect(page.getByText("还没找到，但这不代表它不存在")).toBeVisible();

    await page.goto("/import");
    await page.getByTestId("import-title").fill("没有链接的封面灵感收藏");
    await page.getByTestId("import-raw-share-text").fill("封面设计参考，没有 sourceUrl，用来测试打开原帖兜底");
    await page.getByTestId("import-submit").click();
    await expect(page.getByText("行动卡").first()).toBeVisible();
    await page.getByTestId("detail-open-source").click();
    await expect(page.locator(".toast")).toContainText("还没有可打开的原帖链接");
    await expectNoConsoleErrors(errors);
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    test(`keeps dashboard usable at ${viewport.name} viewport`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "今天，从一条收藏开始" })).toBeVisible();
      const globalSearch = page.getByRole("textbox", { name: "全局搜索" });
      await expect(globalSearch).toBeVisible();
      await globalSearch.fill("剪辑");
      await page.getByRole("button", { name: "搜索" }).click();
      await expect(page.getByTestId("search-result-card").first()).toBeVisible();

      await page.goto("/dashboard");
      await expect(page.getByTestId("recommendation-card").first()).toBeVisible();
      await expect(page.getByTestId("recommendation-card").first().getByTestId("start-action")).toBeEnabled();
      const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
      expect(noHorizontalOverflow).toBe(true);
      await expectNoConsoleErrors(errors);
    });
  }
});

