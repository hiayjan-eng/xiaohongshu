import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, readAppState, resetDemoData } from "./helpers";

function encodePayload(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

test.describe("Import Center architecture", () => {
  test("opens import center and records manual import as ImportBatch", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "把旧收藏和新收藏，都放回行动里" })).toBeVisible();
    await expect(page.getByText("新收藏导入")).toBeVisible();
    await expect(page.getByText("旧收藏扫描 Beta", { exact: true })).toBeVisible();

    await page.getByTestId("import-source-url").fill("https://www.xiaohongshu.com/explore/import-center-test");
    await page.getByTestId("import-title").fill("深圳周末咖啡路线");
    await page.getByTestId("import-raw-share-text").fill("深圳周末咖啡店和展览路线，适合半日出行");
    await page.getByTestId("import-submit").click();

    await expect.poll(async () => (await readAppState(page)).importBatches?.[0]?.source).toBe("manual_single");
    const state = await readAppState(page);
    expect(state.importBatches?.[0]?.importedCount).toBe(1);
    expect(state.importBatchItems?.[0]?.status).toBe("imported");
    expect(state.savedItems.some((item) => item.sourceUrl.includes("import-center-test"))).toBe(true);
    await expectNoConsoleErrors(errors);
  });

  test("imports extension payload into ImportBatch and creates smart album candidates", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    const payload = {
      source: "browser-extension-poc",
      sourcePlatform: "xiaohongshu",
      scannedAt: new Date().toISOString(),
      pageUrl: "https://www.xiaohongshu.com/user/profile/mock/collections",
      items: [
        {
          title: "大理三天慢旅行路线",
          sourceUrl: "https://www.xiaohongshu.com/explore/old-import-dali",
          visibleText: "大理 古城 洱海 喜洲 旅行路线",
          sourcePlatform: "xiaohongshu"
        },
        {
          title: "AI 工具学习清单",
          sourceUrl: "https://www.xiaohongshu.com/explore/old-import-ai-tools",
          visibleText: "AI 工具 提示词 自动化 工作效率",
          sourcePlatform: "xiaohongshu"
        }
      ]
    };

    await page.goto(`/old-import#extension-import=${encodePayload(payload)}`);
    await expect(page.getByRole("heading", { name: "把旧收藏先整理成专辑" })).toBeVisible();
    await expect.poll(async () => (await readAppState(page)).importBatches?.[0]?.source).toBe("extension_scan");

    const state = await readAppState(page);
    expect(state.importBatches?.[0]?.rawCount).toBe(2);
    expect(state.importBatches?.[0]?.importedCount).toBe(2);
    expect(state.importBatchItems?.filter((item) => item.status === "imported").length).toBeGreaterThanOrEqual(2);
    expect(state.smartAlbums?.length).toBeGreaterThan(0);

    await page.goto("/albums");
    await expect(page.getByRole("heading", { name: "智能专辑" })).toBeVisible();
    await expect(page.getByTestId("smart-album-card").first()).toBeVisible();
    await page.getByTestId("confirm-album").first().click();
    await expect.poll(async () => (await readAppState(page)).smartAlbums?.some((album) => album.status === "confirmed")).toBe(true);

    page.once("dialog", async (dialog) => {
      await dialog.accept("测试智能专辑");
    });
    await page.getByRole("button", { name: "改名" }).first().click();
    await expect.poll(async () => (await readAppState(page)).smartAlbums?.some((album) => album.title === "测试智能专辑")).toBe(true);

    await page.getByTestId("archive-album").first().click();
    await expect.poll(async () => (await readAppState(page)).smartAlbums?.some((album) => album.status === "archived")).toBe(true);
    await expectNoConsoleErrors(errors);
  });
});