import { expect, test } from "@playwright/test";
import { collectConsoleErrors, expectNoConsoleErrors, importTestNote, resetDemoData, reviveImportedItem } from "./helpers";

const themes = [
  { id: "sprout", primary: "#4f8a75" },
  { id: "dawn", primary: "#c86f4a" },
  { id: "mist-blue", primary: "#4e7d8c" },
  { id: "paper-ink", primary: "#2e2b26" },
  { id: "lavender-mint", primary: "#7567a8" }
];

async function readThemeSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const card = document.querySelector(".theme-card") ?? document.querySelector(".tool-panel");
    const cardStyle = card ? getComputedStyle(card) : null;
    return {
      theme: document.documentElement.dataset.theme,
      primary: rootStyle.getPropertyValue("--color-primary").trim().toLowerCase(),
      page: rootStyle.getPropertyValue("--color-page").trim().toLowerCase(),
      border: rootStyle.getPropertyValue("--color-border").trim().toLowerCase(),
      bodyBackground: bodyStyle.backgroundColor,
      cardBorder: cardStyle?.borderColor ?? ""
    };
  });
}

test.describe("MVP theme switching", () => {
  test("switches all preset themes, persists after reload, and keeps core actions usable", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await resetDemoData(page);
    await page.goto("/settings");

    let previous = await readThemeSnapshot(page);
    for (const theme of themes) {
      await page.getByTestId(`theme-${theme.id}`).click();
      await expect.poll(async () => (await readThemeSnapshot(page)).theme).toBe(theme.id);
      const snapshot = await readThemeSnapshot(page);
      expect(snapshot.primary).toBe(theme.primary);
      expect(snapshot.page).toBeTruthy();
      expect(snapshot.border).toBeTruthy();
      expect(snapshot.cardBorder).toBeTruthy();
      if (theme.id !== "sprout") {
        expect(snapshot.page).not.toBe(previous.page);
      }
      previous = snapshot;
    }

    await page.reload();
    await expect.poll(async () => (await readThemeSnapshot(page)).theme).toBe("lavender-mint");
    await expect(page.getByTestId("theme-lavender-mint")).toHaveAttribute("aria-pressed", "true");

    const imported = await importTestNote(page, {
      sourceUrl: "https://www.xiaohongshu.com/explore/theme-regression-note",
      title: "主题切换后剪辑测试",
      rawShareText: "剪辑教程和封面设计参考，用来确认主题切换后导入、搜索、完成仍然可用",
      userNote: "主题回归测试"
    });
    await reviveImportedItem(page, imported.id);
    await page.getByTestId("status-completed").click();
    await expect(page.locator(".toast")).toBeVisible();

    await page.goto("/search");
    await page.getByPlaceholder("试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具").fill("主题切换后剪辑");
    await page.locator(".search-page-form").getByRole("button", { name: "找回" }).click();
    await expect(page.getByTestId("search-result-card").first()).toContainText("主题切换后剪辑测试");
    await expectNoConsoleErrors(errors);
  });
});

