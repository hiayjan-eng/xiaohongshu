import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAppState, resetDemoData } from "./helpers";
import { migrateScannedTextV3 } from "../../../../packages/database/src/index";

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
    await page.getByTestId("view-album-items").first().click({ force: true });
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
    await page.getByTestId("view-album-items").first().click({ force: true });
    await expect(page.getByTestId("album-detail")).toBeVisible();

    let dialogIndex = 0;
    page.on("dialog", async (dialog) => {
      dialogIndex += 1;
      await dialog.accept(dialogIndex === 1 ? "工作与职业" : "招聘求职");
    });
    await page.getByRole("button", { name: "改主题" }).first().click({ force: true });

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

    await page.getByTestId("revive-imported-item").click({ force: true });
    await expect.poll(async () => (await readAppState(page)).actionCards.some((card) => card.savedItemId === item.id)).toBe(true);

    let dialogIndex = 0;
    page.on("dialog", async (dialog) => {
      dialogIndex += 1;
      await dialog.accept(dialogIndex === 1 ? "今天" : dialogIndex === 2 ? "20" : dialog.defaultValue());
    });
    await page.getByTestId("add-to-plan-card").click({ force: true });

    state = await readAppState(page);
    expect(state.planCards?.length).toBeGreaterThanOrEqual(1);
    expect(state.planCards?.[0].savedItemId).toBe(item.id);
    expect(state.planCards?.[0].sourceTitle).toContain("小红书封面设计技巧");
    await page.goto("/dashboard");
    await expect(page.getByTestId("today-plan-cards")).toBeVisible();
    await expect(page.getByTestId("today-plan-cards")).toContainText("来源：小红书封面设计技巧");

    await page.getByRole("button", { name: "取消计划" }).first().click({ force: true });
    state = await readAppState(page);
    expect(state.planCards?.[0].status).toBe("cancelled");
    expect(state.planCards?.[0].cancelledAt).toBeTruthy();

    await expectNoConsoleErrors(errors);
  });

  test("postpones a plan card without duplicating it", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    const item = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/plan-card-postpone",
      title: "AI工具日常工作流入门",
      rawShareText: "AI 工具、自动化流程和 Codex 工作流入门",
      userNote: "想把其中一个方法用到项目里"
    });
    await page.getByTestId("revive-imported-item").click({ force: true });
    await expect.poll(async () => (await readAppState(page)).actionCards.some((card) => card.savedItemId === item.id)).toBe(true);

    page.on("dialog", async (dialog) => {
      await dialog.accept(dialog.defaultValue() || "今天");
    });
    await page.getByTestId("add-to-plan-card").click({ force: true });
    await page.goto("/dashboard");
    const before = await readAppState(page);
    expect(before.planCards?.length).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "延期到明天" }).first().click({ force: true });
    const after = await readAppState(page);
    expect(after.planCards?.length).toBe(before.planCards?.length);
    expect(after.planCards?.[0].status).toBe("planned");
    expect(after.planCards?.[0].plannedDate).not.toBe(before.planCards?.[0].plannedDate);

    await expectNoConsoleErrors(errors);
  });

  test("migrates scanned title text without destroying special characters or emoji", () => {
    const report = migrateScannedTextV3({
      schemaVersion: 2,
      user: { id: "user_local_001", name: "本地用户", email: "local@revival.app", createdAt: "2026-07-06T00:00:00.000Z" },
      savedItems: [
        {
          id: "dirty_text_item",
          userId: "user_local_001",
          sourcePlatform: "xiaohongshu",
          sourceUrl: "https://www.xiaohongshu.com/explore/dirty",
          rawShareText: "88 【全÷回血 😆 独立站选品 - 作者A | 小红书】 https://www.xiaohongshu.com/explore/dirty",
          title: "88 【全÷回血 😆 独立站选品 - 作者A | 小红书】 https://www.xiaohongshu.com/explore/dirty",
          userNote: "",
          contentDomain: "商业与经营",
          contentSubDomain: "选品与定价",
          savedIntent: "商业案例参考",
          secondaryIntents: [],
          confidence: "medium",
          whyThisDomain: "测试",
          whyThisIntent: "测试",
          category: "商业与经营",
          subCategory: "选品与定价",
          intent: "商业案例参考",
          whyThisCategory: "测试",
          summary: "测试",
          keywords: ["独立站", "选品"],
          entities: [],
          searchableText: "",
          status: "not_started",
          createdAt: "2026-07-06T00:00:00.000Z",
          updatedAt: "2026-07-06T00:00:00.000Z"
        }
      ],
      actionCards: [],
      searchLogs: [],
      smartAlbums: [],
      importBatches: [],
      importBatchItems: []
    });
    expect(report.checkedCount).toBe(1);
    expect(report.changedCount).toBe(1);
    expect(report.state.savedItems[0].rawTitle).toContain("全÷回血");
    expect(report.state.savedItems[0].title).toContain("全÷回血");
    expect(report.state.savedItems[0].title).toContain("😆");
    expect(report.state.savedItems[0].title).not.toContain("https://");
    expect(report.state.savedItems[0].searchableText).toContain("商业与经营");
  });

  test("previews and applies scanned text migration from settings without auto running", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    await page.goto("/settings");
    await page.getByTestId("settings-preview-text-migration").click();
    await expect(page.getByTestId("text-migration-preview")).toBeVisible();
    await expect(page.getByTestId("text-migration-preview")).toContainText("检查数量");
    await page.getByTestId("settings-apply-text-migration").click();
    await expect(page.getByTestId("text-migration-preview")).toBeHidden();
    await page.getByTestId("settings-undo-text-migration").click();
    await expectNoConsoleErrors(errors);
  });
});
