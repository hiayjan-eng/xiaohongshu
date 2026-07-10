import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, readAppState, resetDemoData } from "./helpers";

const REAL_TEST_STORAGE_KEY = "collection-revival-real-user-tests:v1";

const realNote = {
  sourceUrl: "https://www.xiaohongshu.com/explore/real-test-cover-note",
  title: "小红书封面设计技巧",
  rawShareText: "收藏一个小红书封面设计教程，适合做内容运营和图文排版参考",
  userNote: "之后做震海会小红书图文时可以参考"
};

test.describe("Real user test mode", () => {
  test("creates a real-test record, evaluates it, tests search, persists, and exports", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    await page.evaluate((key) => window.localStorage.removeItem(key), REAL_TEST_STORAGE_KEY);

    await page.goto("/real-test");
    await expect(page.getByRole("heading", { name: "真实试用模式" })).toBeVisible();
    await expect(page.getByTestId("real-test-stat-tested")).toContainText("0 / 20");

    await page.getByTestId("real-test-source-url").fill(realNote.sourceUrl);
    await page.getByTestId("real-test-title").fill(realNote.title);
    await page.getByTestId("real-test-raw-share-text").fill(realNote.rawShareText);
    await page.getByTestId("real-test-user-note").fill(realNote.userNote);
    await page.getByTestId("real-test-generate").click();

    await expect(page.getByTestId("real-test-generated-result")).toContainText(realNote.title);
    await expect(page.getByTestId("real-test-generated-result")).toContainText("下一步行动");
    await expect.poll(async () => (await readAppState(page)).savedItems.some((item) => item.sourceUrl === realNote.sourceUrl)).toBe(true);

    await page.getByTestId("real-test-classification-accurate").click();
    await page.getByTestId("real-test-action-useful").click();
    await page.getByTestId("real-test-next-step-clear").click();
    await page.getByTestId("real-test-today-willing").click();
    await page.getByTestId("real-test-reward-satisfying").click();
    await page.getByTestId("real-test-search-query").fill("封面");
    await page.getByTestId("real-test-search-button").click();
    await expect(page.getByTestId("real-test-search-status")).toContainText("找到了");
    await page.getByTestId("real-test-issue-note").fill("封面类行动卡还可以更偏实操一点");
    await page.getByTestId("real-test-save").click();

    await expect(page.getByTestId("real-test-stat-tested")).toContainText("1 / 20");
    await expect(page.getByTestId("real-test-stat-classification")).toContainText("100%");
    await expect(page.getByTestId("real-test-stat-search")).toContainText("100%");
    await expect(page.getByTestId("real-test-record")).toContainText(realNote.title);

    const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "[]"), REAL_TEST_STORAGE_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0].classificationRating).toBe("accurate");
    expect(stored[0].searchFound).toBe(true);

    await page.reload();
    await expect(page.getByTestId("real-test-record")).toContainText(realNote.title);
    await expect(page.getByTestId("real-test-stat-tested")).toContainText("1 / 20");

    const markdownDownload = page.waitForEvent("download");
    await page.getByTestId("real-test-export-md").click();
    await expect((await markdownDownload).suggestedFilename()).toContain("real-test.md");

    const jsonDownload = page.waitForEvent("download");
    await page.getByTestId("real-test-export-json").click();
    await expect((await jsonDownload).suggestedFilename()).toContain("real-test.json");

    await page.getByTestId("real-test-copy-summary").click();
    await expect(page.getByText("试用总结已复制")).toBeVisible();
    await expectNoConsoleErrors(errors);
  });

  test("opens real-test mode from the QA panel", async ({ page }) => {
    await page.goto("/qa");
    await page.getByTestId("qa-real-test").click();
    await expect(page.getByRole("heading", { name: "真实试用模式" })).toBeVisible();
  });
});