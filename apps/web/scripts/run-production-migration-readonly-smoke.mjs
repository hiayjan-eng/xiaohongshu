import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const keys = { marker: "collection-revival-storage-bootstrap:v1", app: "collection-revival-system:v1", theme: "collection-revival-theme", achievements: "collection-revival-achievements" };
const fixture = { schemaVersion: 3, user: { id: "migration-fixture-user", name: "Migration Fixture", email: "fixture@example.invalid", createdAt: "2026-07-27T00:00:00.000Z" }, savedItems: [], actionCards: [], planCards: [], classificationCorrections: [], searchLogs: [], smartAlbums: [], importBatches: [], importBatchItems: [] };
const report = { startedAt: new Date().toISOString() };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.addInitScript(({ keys, fixture }) => { localStorage.setItem(keys.app, JSON.stringify(fixture)); localStorage.setItem(keys.theme, "sprout"); localStorage.setItem(keys.achievements, "{}"); }, { keys, fixture });
  const response = await page.goto("https://xiaohongshu-green.vercel.app/settings/data-migration", { waitUntil: "networkidle" });
  const state = await page.evaluate(async (storageKeys) => ({ marker: localStorage.getItem(storageKeys.marker), databases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : [] }), keys);
  report.status = response?.status() ?? null;
  report.appShell = await page.locator(".app-shell").count() > 0;
  report.inspectionEntry = await page.getByTestId("migration-inspection-step").count() > 0;
  report.marker = state.marker === null ? "absent" : "present";
  report.indexedDbDatabases = state.databases;
  report.visibleText = (await page.locator("body").innerText()).slice(0, 500);
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); }
finally { await context.close(); await browser.close(); report.finishedAt = new Date().toISOString(); await mkdir(resolve("apps/web/test-results/production-isolation-smoke"), { recursive: true }); await writeFile(resolve("apps/web/test-results/production-isolation-smoke/migration-readonly.json"), JSON.stringify(report, null, 2)); }
if (report.failure) process.exitCode = 1;
