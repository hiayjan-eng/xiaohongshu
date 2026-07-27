import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = "https://xiaohongshu-green.vercel.app/";
const outputDirectory = resolve("apps/web/test-results/production-smoke-diagnostic");
const keys = [
  "collection-revival-storage-bootstrap:v1",
  "collection-revival-system:v1",
  "collection-revival-theme",
  "collection-revival-achievements"
];
const report = { url, startedAt: new Date().toISOString(), responses: [], failedRequests: [], consoleErrors: [], pageErrors: [], unhandledRejections: [], snapshots: {} };

async function snapshot(page) {
  return page.evaluate(async (storageKeys) => ({
    title: document.title,
    href: location.href,
    readyState: document.readyState,
    rootExists: Boolean(document.querySelector("#root")),
    rootChildElementCount: document.querySelector("#root")?.childElementCount ?? 0,
    rootInnerHtmlLength: document.querySelector("#root")?.innerHTML.length ?? 0,
    visibleText: (document.body.innerText || "").slice(0, 500),
    appShell: Boolean(document.querySelector(".app-shell")),
    bootstrapState: document.querySelector("[data-app-bootstrap-state]")?.getAttribute("data-app-bootstrap-state") ?? null,
    main: Boolean(document.querySelector("main")),
    nav: Boolean(document.querySelector("nav")),
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    recovery: Boolean(document.querySelector("[data-testid*='recovery'], [data-testid*='failed'], [data-testid*='degraded']")),
    loading: Boolean(document.querySelector("[data-testid*='loading'], [data-testid*='boot']")),
    storage: Object.fromEntries(storageKeys.map((key) => [key, localStorage.getItem(key) === null ? "absent" : "present"])),
    indexedDbDatabases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : "unsupported"
  }), storageKeys);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
report.chromiumVersion = browser.version();
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on("response", (response) => {
    if (["document", "script", "stylesheet"].includes(response.request().resourceType())) report.responses.push({ type: response.request().resourceType(), url: response.url(), status: response.status() });
  });
  page.on("requestfailed", (request) => report.failedRequests.push({ url: request.url(), type: request.resourceType(), error: request.failure()?.errorText ?? "unknown" }));
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.addInitScript(() => window.addEventListener("unhandledrejection", (event) => {
    const values = (window.__phase2UnhandledRejections ??= []);
    values.push(String(event.reason));
  }));
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  report.documentStatus = response?.status() ?? null;
  report.snapshots.domContentLoaded = await snapshot(page);
  await page.waitForLoadState("networkidle");
  report.snapshots.networkIdle = await snapshot(page);
  report.unhandledRejections = await page.evaluate(() => window.__phase2UnhandledRejections ?? []);
  await page.screenshot({ path: resolve(outputDirectory, "desktop.png"), fullPage: true });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(url, { waitUntil: "networkidle" });
  report.snapshots.mobile = { ...(await snapshot(mobilePage)), dimensions: await mobilePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })) };
  await mobilePage.screenshot({ path: resolve(outputDirectory, "mobile.png"), fullPage: true });
  await mobile.close();
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(outputDirectory, "diagnostic.json"), JSON.stringify(report, null, 2));
}

if (report.failure) process.exitCode = 1;
