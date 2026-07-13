import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAppState, resetDemoData } from "./helpers";

const genericNextActionPattern = /拆解一个参考案例|记录\s*3\s*个可模仿|先了解一下|整理成计划/;

const classificationCases = [
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-cover-design",
      title: "小红书封面设计技巧",
      rawShareText: "收藏一个小红书封面设计教程，适合做内容运营和图文排版参考",
      userNote: "之后做震海会小红书图文时可以参考"
    },
    category: "内容创作",
    subCategoryPattern: /小红书运营|封面设计|选题文案/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-ai-workflow",
      title: "AI工具日常工作流入门",
      rawShareText: "ChatGPT 提示词和自动化工作流教程，适合提升办公效率",
      userNote: "想先复现第一个案例"
    },
    category: "AI 与效率",
    subCategoryPattern: /AI 工具|效率工作流/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-shenzhen-weekend",
      title: "深圳周末展览路线",
      rawShareText: "深圳周末展览、市集和咖啡路线，适合半日出行",
      userNote: "周末想去，先看交通和预算"
    },
    category: "出行与探店",
    subCategoryPattern: /展览活动|周末去处|美食探店/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-low-cal-dinner",
      title: "低卡晚餐备餐",
      rawShareText: "低卡晚餐和减脂备餐食材清单，适合工作日做饭",
      userNote: "想整理成购物清单"
    },
    category: "饮食与健康",
    subCategoryPattern: /低卡备餐|菜谱做饭/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-relationship-needs",
      title: "关系中如何表达需求",
      rawShareText: "亲密关系沟通，如何表达需求和边界感，适合手帐复盘",
      userNote: "想写一个自己的例子"
    },
    category: "情绪与关系",
    subCategoryPattern: /亲密关系|情绪成长|自我观察/
  }
];

test.describe("classification and action-card quality", () => {
  test("classifies real-like Xiaohongshu imports into primary and secondary categories", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    for (const entry of classificationCases) {
      const item = await importTestNote(page, entry.note);
      const state = await readAppState(page);
      const savedItem = state.savedItems.find((candidate) => candidate.id === item.id);
      const actionCard = state.actionCards.find((card) => card.savedItemId === item.id);

      expect(savedItem?.category).toBe(entry.category);
      expect(savedItem?.subCategory).toMatch(entry.subCategoryPattern);
      expect(savedItem?.category).not.toBe("暂存");
      expect(savedItem?.whyThisCategory).toBeTruthy();
      expect(actionCard?.title).not.toMatch(/行动卡行动卡|其他行动卡行动卡/);
      expect(actionCard?.nextAction).toBeTruthy();
      expect(actionCard?.nextAction).not.toMatch(genericNextActionPattern);
      expect(actionCard?.openOriginalFocus?.length).toBeGreaterThan(0);
      expect(actionCard?.output).toBeTruthy();
      expect(actionCard?.fields).toHaveProperty("打开原帖后重点看什么");
    }

    await expectNoConsoleErrors(errors);
  });

  test("shows a clear continue-import action after manual import", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    await page.goto("/import");
    await page.getByTestId("import-source-url").fill("https://www.xiaohongshu.com/explore/quality-continue-import");
    await page.getByTestId("import-title").fill("小红书选题封面灵感");
    await page.getByTestId("import-raw-share-text").fill("内容创作选题和封面结构参考");
    await page.getByTestId("import-submit").click();

    await expect(page.getByTestId("import-success-panel")).toContainText("整理完成");
    await expect(page.getByTestId("import-success-panel")).toContainText("打开原帖后重点看");
    await expect(page.getByTestId("continue-import")).toBeVisible();
    await page.getByTestId("continue-import").click();
    await expect(page.getByTestId("import-title")).toHaveValue("");

    await expectNoConsoleErrors(errors);
  });

  test("old import clearly explains the local extension beta requirement", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/old-import");

    await expect(page.getByTestId("old-import-extension-warning")).toContainText("需要本地浏览器扩展 Beta");
    await expect(page.getByText("不是 Chrome / Edge 商店正式扩展")).toBeVisible();
    await expect(page.getByRole("button", { name: "没有扩展？先用新收藏导入测试" })).toBeVisible();

    await expectNoConsoleErrors(errors);
  });
});