import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAppState, resetDemoData } from "./helpers";

test.describe("product core stabilization", () => {
  test("hides internal QA and real-test from the normal sidebar but keeps routes accessible", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/dashboard?dev=0");
    await page.evaluate(() => window.localStorage.removeItem("developerMode"));
    await page.goto("/dashboard?dev=0");

    await expect(page.getByRole("navigation", { name: "主导航" })).not.toContainText("QA");
    await expect(page.getByRole("navigation", { name: "主导航" })).not.toContainText("真实试用");

    await page.goto("/settings");
    await expect(page.getByTestId("developer-tools-panel")).toContainText("开发与测试");
    await page.goto("/qa");
    await expect(page.getByRole("heading", { name: "7 天稳定性检查面板" })).toBeVisible();
    await page.goto("/real-test");
    await expect(page.getByRole("heading", { name: "真实试用模式" })).toBeVisible();

    await expectNoConsoleErrors(errors);
  });

  test("opens a refreshable smart album detail route", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    await page.goto("/albums");
    await expect(page.getByTestId("smart-album-card").first()).toBeVisible();
    await page.getByTestId("view-album-items").first().click();
    await expect(page).toHaveURL(/\/albums\/album_/);
    await expect(page.getByTestId("album-detail")).toBeVisible();
    await expect(page.getByTestId("album-detail")).toContainText("专辑类型");
    await page.reload();
    await expect(page.getByTestId("album-detail")).toBeVisible();

    await expectNoConsoleErrors(errors);
  });

  test("records classification corrections and allows undo", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    await page.goto("/albums");
    await page.getByTestId("view-album-items").first().click();
    await expect(page.getByTestId("album-detail")).toBeVisible();

    let dialogIndex = 0;
    page.on("dialog", async (dialog) => {
      dialogIndex += 1;
      await dialog.accept(dialogIndex === 1 ? "工作与职业" : "招聘求职");
    });
    await page.getByRole("button", { name: "改主题" }).first().click();

    await expect.poll(async () => {
      const state = await readAppState(page);
      return state.classificationCorrections?.length ?? 0;
    }).toBeGreaterThan(0);
    const correctedState = await readAppState(page);
    expect(correctedState.savedItems.some((item) => item.contentDomain === "工作与职业" && item.searchableText.includes("工作与职业"))).toBe(true);

    await page.getByRole("button", { name: "撤销上次分类修改" }).click();
    await expect.poll(async () => {
      const state = await readAppState(page);
      return state.classificationCorrections?.length ?? 0;
    }).toBe(0);

    await expectNoConsoleErrors(errors);
  });

  test("creates a lightweight plan card only after the user explicitly confirms", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    const item = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/plan-card-flow",
      title: "小红书封面设计技巧",
      rawShareText: "封面设计、标题结构和图文排版参考",
      userNote: "下次写图文时想复用"
    });
    let state = await readAppState(page);
    expect(state.planCards?.length ?? 0).toBe(0);

    await page.getByTestId("revive-imported-item").click();
    await expect.poll(async () => (await readAppState(page)).actionCards.some((card) => card.savedItemId === item.id)).toBe(true);

    let dialogIndex = 0;
    page.on("dialog", async (dialog) => {
      dialogIndex += 1;
      await dialog.accept(dialogIndex === 1 ? "今天" : dialogIndex === 2 ? "20" : dialog.defaultValue());
    });
    await page.getByTestId("add-to-plan-card").click();

    state = await readAppState(page);
    expect(state.planCards?.length).toBeGreaterThanOrEqual(1);
    expect(state.planCards?.[0].savedItemId).toBe(item.id);
    await page.goto("/dashboard");
    await expect(page.getByTestId("today-plan-cards")).toBeVisible();

    await expectNoConsoleErrors(errors);
  });
});
