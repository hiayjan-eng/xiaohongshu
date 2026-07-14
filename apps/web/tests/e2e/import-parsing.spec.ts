import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, getOpenedUrls, installWindowOpenSpy, readAppState, STORAGE_KEY, submitQuickImportForm } from "./helpers";

const realShareText = "84【3个方法，让codex帮你猛猛干活！！ - 哈哈du（AI版） | 小红书";
const completeShareText = "84 【3个方法，让codex帮你猛猛干活！！ - 哈哈du（AI版） | 小红书 - 你的生活兴趣社区】 😆 rATpqUVrDCynYon 😆 https://www.xiaohongshu.com/discovery/item/6a15293600000000080251c2?source=webshare&xhsshare=pc_web&xsec_token=ABobC_c5yh6oYzxIhcHIIOEH1BA37iKtmIhraFY25m_D4=&xsec_source=pc_share";

async function seedLegacyOtherData(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate((key) => {
    const now = "2026-07-13T00:00:00.000Z";
    window.localStorage.setItem(key, JSON.stringify({
      user: {
        id: "user_local_001",
        name: "本地用户",
        email: "local@revival.app",
        createdAt: now
      },
      savedItems: [
        {
          id: "legacy_other_001",
          userId: "user_local_001",
          sourcePlatform: "xiaohongshu",
          sourceUrl: "https://www.xiaohongshu.com/explore/legacy-other",
          rawShareText: "旧版本生成的粗糙测试数据",
          title: "其他行动卡行动卡",
          userNote: "",
          category: "其他",
          subCategory: "其他",
          classificationConfidence: "low",
          intent: "旧版本兜底结果",
          whyThisCategory: "旧版本没有判断原因",
          summary: "这条收藏 可能和早慧的人、应该把敏感还给自己、http有关",
          keywords: ["其他"],
          entities: [],
          searchableText: "其他行动卡",
          status: "not_started",
          createdAt: now,
          updatedAt: now
        }
      ],
      actionCards: [
        {
          id: "legacy_card_001",
          savedItemId: "legacy_other_001",
          category: "其他",
          subCategory: "其他",
          title: "其他行动卡行动卡",
          goal: "旧版本兜底目标",
          whySaved: "旧版本没有收藏原因",
          nextAction: "拆解一个参考案例，并记录 3 个可模仿的动作",
          openOriginalFocus: [],
          output: "",
          estimatedTime: "20分钟",
          difficulty: "低",
          doneCriteria: "",
          avoidDoing: "",
          ifInfoMissing: "",
          followUp: "",
          fields: {},
          tasks: [],
          createdAt: now,
          updatedAt: now
        }
      ],
      searchLogs: [],
      smartAlbums: []
    }));
    window.localStorage.removeItem("collection-revival-achievements");
  }, STORAGE_KEY);
}

test.describe("real share text import parsing", () => {
  test("imports a non-URL Xiaohongshu share text without JS errors and keeps old data from polluting the UI", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedLegacyOtherData(page);

    await page.goto("/import");
    await expect(page.getByLabel("粘贴链接或分享文本")).toBeVisible();
    await page.getByTestId("import-source-url").fill(realShareText);
    await submitQuickImportForm(page);

    await expect(page.getByTestId("import-success-panel")).toBeVisible();
    await expect(page.getByTestId("import-success-panel")).toContainText("AI 与效率");
    await expect(page.getByTestId("import-success-panel")).not.toContainText("其他行动卡");
    await expect(page.locator("body")).not.toContainText("Cannot read properties of undefined");

    const state = await readAppState(page);
    const imported = state.savedItems.find((item) => item.rawShareText.includes("codex") || item.title.toLowerCase().includes("codex")) as (typeof state.savedItems[number] & { subCategory?: string; sourcePlatform?: string }) | undefined;
    expect(imported).toBeTruthy();
    expect(imported?.sourceUrl).toBe("");
    expect(imported?.sourcePlatform).toBe("manual");
    expect(imported?.category).toBe("AI 与效率");
    expect(imported?.subCategory).toMatch(/AI 工具|效率工作流|自动化工作流|软件教程|Prompt 工程|决策辅助/);

    expect(state.actionCards.some((card) => card.savedItemId === imported?.id)).toBe(false);
    await page.getByTestId("revive-imported-item").click({ force: true });
    await expect.poll(async () => (await readAppState(page)).actionCards.some((card) => card.savedItemId === imported?.id)).toBe(true);
    const importedCard = (await readAppState(page)).actionCards.find((card) => card.savedItemId === imported?.id);
    expect(importedCard?.title).not.toMatch(/其他行动卡|行动卡行动卡/);
    expect(importedCard?.nextAction).not.toMatch(/拆解一个参考案例|记录\s*3\s*个可模仿|Cannot read properties/);

    await page.goto("/pool");
    await expect(page.locator("body")).not.toContainText("其他行动卡");
    await expect(page.locator("body")).not.toContainText("行动卡行动卡");
    await expect(page.getByText("暂存 / 待补充备注").first()).toBeVisible();

    const importedPoolCard = page.getByTestId("saved-item-card").filter({ hasText: /codex|Codex|3个方法/ }).first();
    await expect(importedPoolCard).toBeVisible();
    await expect(importedPoolCard.getByTestId("open-source-unavailable")).toContainText("暂无原帖链接");
    await expect(importedPoolCard.getByTestId("open-source")).toHaveCount(0);

    await expectNoConsoleErrors(errors);
  });

  test("extracts a real Xiaohongshu URL from a complete share text and keeps open-original usable", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await installWindowOpenSpy(page);

    await page.goto("/import");
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await page.getByTestId("import-source-url").fill(completeShareText);
    await submitQuickImportForm(page);

    await expect(page.getByTestId("import-success-panel")).toBeVisible();
    await expect(page.getByTestId("import-success-panel")).toContainText("AI 与效率");
    await expect(page.locator("body")).not.toContainText("Cannot read properties of undefined");

    const state = await readAppState(page);
    const imported = state.savedItems.find((item) => item.sourceUrl.includes("/discovery/item/6a15293600000000080251c2")) as (typeof state.savedItems[number] & { subCategory?: string; sourcePlatform?: string; rawShareText: string }) | undefined;
    expect(imported).toBeTruthy();
    expect(imported?.sourceUrl).toContain("https://www.xiaohongshu.com/discovery/item/6a15293600000000080251c2");
    expect(imported?.sourceUrl).toContain("source=webshare");
    expect(imported?.sourcePlatform).toBe("xiaohongshu");
    expect(imported?.title).toBe("3个方法，让codex帮你猛猛干活！！");
    expect(imported?.rawShareText).toContain("3个方法，让codex帮你猛猛干活");
    expect(imported?.rawShareText).not.toContain("https://www.xiaohongshu.com/discovery/item");
    expect(imported?.category).toBe("AI 与效率");
    expect(imported?.subCategory).toMatch(/AI 工具|效率工作流|自动化工作流|软件教程|Prompt 工程|决策辅助/);

    await page.goto("/pool");
    const importedPoolCard = page.getByTestId("saved-item-card").filter({ hasText: "3个方法，让codex帮你猛猛干活" }).first();
    await expect(importedPoolCard).toBeVisible();
    await expect(importedPoolCard.getByTestId("open-source")).toBeVisible();
    await expect(importedPoolCard.getByTestId("open-source-unavailable")).toHaveCount(0);
    await importedPoolCard.getByTestId("open-source").click();
    await expect.poll(async () => (await getOpenedUrls(page)).some((url) => url.includes("/discovery/item/6a15293600000000080251c2"))).toBe(true);

    await expectNoConsoleErrors(errors);
  });
});
