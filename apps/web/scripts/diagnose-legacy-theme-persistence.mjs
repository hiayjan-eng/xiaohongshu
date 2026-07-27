import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const keys = { marker: "collection-revival-storage-bootstrap:v1", app: "collection-revival-system:v1", theme: "collection-revival-theme", achievements: "collection-revival-achievements" };
const now = "2026-07-27T00:00:00.000Z";
const state = { schemaVersion: 3, user: { id: "fixture-user", name: "Fixture", email: "fixture@example.invalid", createdAt: now }, savedItems: [{ id: "fixture-item", userId: "fixture-user", sourcePlatform: "fixture", sourceUrl: "https://fixture.invalid", rawShareText: "fixture", rawTitle: "Fixture favorite", cleanedTitle: "Fixture favorite", displayTitle: "Fixture favorite", textNormalizationVersion: 3, title: "Fixture favorite", userNote: "fixture", contentDomain: "AI 与效率", contentSubDomain: "工具", savedIntent: "想学习", secondaryIntents: [], confidence: "high", whyThisDomain: "fixture", whyThisIntent: "fixture", category: "AI 与效率", subCategory: "工具", classificationConfidence: "high", intent: "学习", whyThisCategory: "fixture", summary: "fixture", keywords: ["fixture"], entities: [], searchableText: "fixture", status: "not_started", createdAt: now, updatedAt: now }], actionCards: [], planCards: [], classificationCorrections: [], searchLogs: [], smartAlbums: [], importBatches: [], importBatchItems: [] };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const read = () => page.evaluate(async (storageKeys) => ({ values: Object.fromEntries(Object.entries(storageKeys).map(([name, key]) => [name, localStorage.getItem(key)])), databases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : [] }), keys);
const report = {};
try {
  await page.addInitScript(({ keys, state }) => { localStorage.setItem(keys.app, JSON.stringify(state)); localStorage.setItem(keys.theme, "lavender-mint"); localStorage.setItem(keys.achievements, JSON.stringify({ first_revival: "2026-07-27T00:00:00.000Z" })); }, { keys, state });
  await page.goto("https://xiaohongshu-green.vercel.app/settings", { waitUntil: "networkidle" });
  report.before = await read();
  await page.getByTestId("theme-dawn").click();
  report.afterClick = await read();
  await page.waitForFunction((key) => localStorage.getItem(key) === "dawn", keys.theme).catch((error) => { report.waitFailure = String(error); });
  report.afterWait = await read();
  await page.reload({ waitUntil: "networkidle" });
  report.afterReload = await read();
} finally {
  await context.close(); await browser.close();
  await mkdir(resolve("apps/web/test-results/production-isolation-smoke"), { recursive: true });
  await writeFile(resolve("apps/web/test-results/production-isolation-smoke/legacy-theme-diagnostic.json"), JSON.stringify(report, null, 2));
}
