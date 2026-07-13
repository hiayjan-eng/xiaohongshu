import { chromium } from "@playwright/test";

const base = "https://xiaohongshu-green.vercel.app";
const shareText = "84【3个方法，让codex帮你猛猛干活！！ - 哈哈du（AI版） | 小红书";
const storageKey = "collection-revival-system:v1";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

for (const path of ["/", "/import", "/old-import", "/albums", "/qa", "/real-test", "/search", "/settings"]) {
  const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response?.ok()) throw new Error(`${path} status ${response?.status()}`);
}

await page.goto(`${base}/import`, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
await page.getByTestId("import-source-url").fill(shareText);
await page.getByTestId("import-submit").click();
await page.getByTestId("import-success-panel").waitFor({ state: "visible", timeout: 20_000 });
const importPanel = await page.getByTestId("import-success-panel").innerText();
if (!importPanel.includes("AI 与效率")) throw new Error("import panel missing AI category");
if (!importPanel.includes("整理完成")) throw new Error("import panel missing completion copy");
if ((await page.locator("body").innerText()).includes("Cannot read properties of undefined")) throw new Error("raw JS error displayed");

await page.goto(`${base}/old-import`, { waitUntil: "domcontentloaded", timeout: 45_000 });
const oldImportText = await page.locator("body").innerText();
if (!oldImportText.includes("需要先安装本地浏览器扩展 Beta")) throw new Error("old-import beta warning missing");
if (!oldImportText.includes("普通测试用户可以先不用这个功能")) throw new Error("old-import skip guidance missing");

await page.goto(`${base}/search`, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.getByPlaceholder("试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具").fill("codex");
await page.locator(".search-page-form").getByRole("button", { name: "找回" }).click();
await page.getByTestId("search-result-card").first().waitFor({ state: "visible", timeout: 20_000 });

await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.getByTestId("theme-dawn").click();
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
if (theme !== "dawn") throw new Error(`theme switch failed: ${theme}`);

if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
console.log(JSON.stringify({ ok: true, paths: 8, import: "passed", oldImport: "passed", search: "passed", theme }, null, 2));
await browser.close();