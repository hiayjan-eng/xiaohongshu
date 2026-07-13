import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, readAppState, resetDemoData, reviveImportedItem } from "./helpers";

const genericNextActionPattern = /拆解一个参考案例|记录\s*3\s*个可模仿|先了解一下|整理成计划/;

const classificationCases = [
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-cover-design",
      title: "小红书封面设计技巧",
      rawShareText: "收藏一个小红书封面设计教程，适合做内容运营和图文排版参考",
      userNote: "之后做震海会小红书图文时可以参考"
    },
    domain: "内容创作",
    subDomainPattern: /小红书运营|封面设计|选题文案/,
    intentPattern: /内容创作参考|想学习|想复现/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-ai-cut-video",
      title: "不用剪辑软件，100% AI 剪辑视频教程",
      rawShareText: "AI 剪辑视频教程，不用传统剪辑软件也能做短视频",
      userNote: "想学习或复现这个剪辑方法"
    },
    domain: "内容创作",
    subDomainPattern: /视频剪辑/,
    intentPattern: /想学习|想复现/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-ai-roundtable-prompt",
      title: "长脑子最快的方式就是跟顶级好脑聊天",
      rawShareText: "使用 Jung、Mankiw、Munger、Musk 多角色圆桌 Prompt 分析工作安排和决策",
      userNote: "想复现这个 prompt，用来做工作安排和商业认知决策"
    },
    domain: "AI 与效率",
    subDomainPattern: /Prompt 工程|决策辅助|多角色推演/,
    intentPattern: /工作决策参考|想复现/
  },
  {
    note: {
      sourceUrl: "https://www.xiaohongshu.com/explore/quality-relationship-needs",
      title: "关系中如何表达需求",
      rawShareText: "亲密关系沟通，如何表达需求和边界感，适合手帐复盘",
      userNote: "以后写文章也可能参考这个观点"
    },
    domain: "情绪与关系",
    subDomainPattern: /亲密关系|情绪成长|自我观察/,
    intentPattern: /内容创作参考|情绪共鸣/
  }
];

test.describe("classification, saved intent, and on-demand action cards", () => {
  test("separates content domain from saved intent for real-like imports", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);

    for (const entry of classificationCases) {
      const item = await importTestNote(page, entry.note);
      let state = await readAppState(page);
      let savedItem = state.savedItems.find((candidate) => candidate.id === item.id);

      expect(savedItem?.contentDomain).toBe(entry.domain);
      expect(savedItem?.contentSubDomain).toMatch(entry.subDomainPattern);
      expect(savedItem?.savedIntent).toMatch(entry.intentPattern);
      expect(savedItem?.contentDomain).not.toBe("暂存");
      expect(savedItem?.whyThisDomain).toBeTruthy();
      expect(savedItem?.whyThisIntent).toBeTruthy();
      expect(state.actionCards.some((card) => card.savedItemId === item.id)).toBe(false);

      const actionCard = await reviveImportedItem(page, item.id);
      state = await readAppState(page);
      savedItem = state.savedItems.find((candidate) => candidate.id === item.id);
      expect(actionCard.title).not.toMatch(/行动卡行动卡|其他行动卡行动卡/);
      expect(actionCard.nextAction).toBeTruthy();
      expect(actionCard.nextAction).not.toMatch(genericNextActionPattern);
      expect(actionCard.openOriginalFocus?.length).toBeGreaterThan(0);
      expect(actionCard.output).toBeTruthy();
      expect(actionCard.fields).toHaveProperty("打开原帖后重点看什么");
      expect(savedItem?.contentDomain).toBe(entry.domain);
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
    await expect(page.getByTestId("import-success-panel")).toContainText("收藏用途");
    await expect(page.getByTestId("continue-import")).toBeVisible();
    await page.getByTestId("continue-import").click();
    await expect(page.getByTestId("import-title")).toHaveValue("");

    await expectNoConsoleErrors(errors);
  });

  test("old import explains the extension beta requirement and download path with simulated handshake", async ({ page, request }) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/old-import");

    await expect(page.getByTestId("old-import-extension-warning")).toContainText("桌面浏览器扩展 Beta");
    const download = page.getByRole("link", { name: "下载旧收藏扫描 Beta ZIP" });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute("href", /collection-revival-extension-beta-v0\.2\.1\.zip/);
    const zipResponse = await request.get("/downloads/collection-revival-extension-beta-v0.2.1.zip");
    expect(zipResponse.ok()).toBeTruthy();
    expect((await zipResponse.body()).length).toBeGreaterThan(1000);

    await expect(page.getByTestId("extension-connection-status")).toContainText("扩展未连接");
    await page.evaluate(() => {
      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (event.data?.source !== "collection-revival-web") return;
        if (event.data?.type !== "COLLECTION_REVIVAL_EXTENSION_PING") return;
        window.postMessage({
          source: "collection-revival-extension",
          type: "COLLECTION_REVIVAL_EXTENSION_PONG",
          requestId: event.data.requestId,
          extensionVersion: "0.2.1",
          protocolVersion: "collection-revival-web-bridge-v1",
          browser: "Chrome",
          capabilities: ["web-bridge", "xhs-visible-dom-scan"],
          timestamp: new Date().toISOString()
        }, window.location.origin);
      });
    });
    await page.getByTestId("detect-extension").click();
    await expect(page.getByTestId("extension-connection-status")).toContainText("扩展已连接");
    await expect(page.getByTestId("extension-connection-status")).toContainText("v0.2.1");
    await expect(page.getByTestId("extension-diagnostics")).toContainText("PONG");
    await expect(page.getByRole("button", { name: "我已安装，检测扩展" })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开小红书收藏页" })).toBeVisible();
    await expect(page.getByRole("button", { name: "没有扩展？先用新收藏导入测试" })).toBeVisible();

    await expectNoConsoleErrors(errors);
  });
});
