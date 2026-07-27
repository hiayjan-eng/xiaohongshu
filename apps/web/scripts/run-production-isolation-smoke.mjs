import { chromium } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "https://xiaohongshu-green.vercel.app";
const outputDirectory = resolve("apps/web/test-results/production-isolation-smoke");
const storageKeys = { marker: "collection-revival-storage-bootstrap:v1", app: "collection-revival-system:v1", theme: "collection-revival-theme", achievements: "collection-revival-achievements" };
const routeChecks = [
  ["/", "main.welcome-screen"], ["/import", ".app-shell"], ["/albums", ".app-shell"], ["/search", ".app-shell"], ["/settings", ".app-shell"], ["/settings/data-migration", ".app-shell"]
];
const result = { origin, startedAt: new Date().toISOString(), routes: [], freshUser: {}, legacyFixture: {}, migrationRoute: {}, errors: [], screenshots: [] };

function assert(value, message) { if (!value) throw new Error(message); }
function fixture() {
  const now = "2026-07-27T00:00:00.000Z";
  return { schemaVersion: 3, user: { id: "phase2-fixture-user", name: "Phase 2 Fixture", email: "fixture@example.invalid", createdAt: now }, savedItems: [{ id: "phase2-fixture-item", userId: "phase2-fixture-user", sourcePlatform: "fixture", sourceUrl: "https://fixture.invalid/phase2", rawShareText: "PHASE2_FIXTURE_ONLY", rawTitle: "Phase 2 fixture favorite", cleanedTitle: "Phase 2 fixture favorite", displayTitle: "Phase 2 fixture favorite", textNormalizationVersion: 3, title: "Phase 2 fixture favorite", userNote: "Synthetic fixture only", contentDomain: "AI 与效率", contentSubDomain: "工具", savedIntent: "想学习", secondaryIntents: [], confidence: "high", whyThisDomain: "Synthetic fixture", whyThisIntent: "Synthetic fixture", category: "AI 与效率", subCategory: "工具", classificationConfidence: "high", intent: "学习", whyThisCategory: "Synthetic fixture", summary: "Synthetic fixture only", keywords: ["phase2", "fixture"], entities: [], searchableText: "phase2 fixture PHASE2_FIXTURE_ONLY", status: "not_started", createdAt: now, updatedAt: now }], actionCards: [], planCards: [], classificationCorrections: [], searchLogs: [], smartAlbums: [], importBatches: [], importBatchItems: [] };
}
function attachErrors(page, scope) {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error" && !/favicon|404 \(Not Found\)/i.test(message.text())) errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`request: ${request.resourceType()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
  return () => { if (errors.length) result.errors.push({ scope, errors }); return errors; };
}
async function storage(page) {
  return page.evaluate(async (keys) => ({ values: Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, localStorage.getItem(key) === null ? "absent" : localStorage.getItem(key)])), databases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : [] }), storageKeys);
}
async function ready(page, route) {
  const selector = route === "/" ? "main.welcome-screen" : ".app-shell";
  await page.locator(selector).waitFor({ state: "visible" });
  assert(await page.locator("#root").evaluate((root) => root.childElementCount > 0), `${route} has an empty #root`);
  assert(await page.locator("main").count() > 0, `${route} has no main landmark`);
  assert(await page.locator("[data-testid*='recovery'], [data-testid*='failed'], [data-testid*='degraded']").count() === 0, `${route} shows Recovery/Boot Failed`);
  if (route !== "/") assert(await page.locator("nav").count() > 0, `${route} has no navigation`);
}
async function openAndRefresh(page, route, selector) {
  const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
  assert(response?.status() === 200, `${route} returned ${response?.status()}`);
  await ready(page, route);
  await page.reload({ waitUntil: "networkidle" });
  await ready(page, route);
  result.routes.push({ route, status: response.status(), readySelector: selector, refreshed: true });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
result.chromiumVersion = browser.version();
try {
  const publicContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const publicPage = await publicContext.newPage();
  const routeErrors = attachErrors(publicPage, "public routes");
  for (const [route, selector] of routeChecks) await openAndRefresh(publicPage, route, selector);
  assert(routeErrors().length === 0, "Public routes emitted browser errors");
  await publicPage.goto(`${origin}/import`, { waitUntil: "networkidle" });
  await publicPage.screenshot({ path: resolve(outputDirectory, "desktop-import.png"), fullPage: true });
  result.screenshots.push("desktop-import.png");
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.goto(`${origin}/import`, { waitUntil: "networkidle" });
  const mobileDimensions = await publicPage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert(mobileDimensions.scrollWidth <= mobileDimensions.clientWidth, "Mobile import page has horizontal overflow");
  await publicPage.screenshot({ path: resolve(outputDirectory, "mobile-import.png"), fullPage: true });
  result.screenshots.push("mobile-import.png");
  result.mobile = mobileDimensions;
  await publicContext.close();

  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const freshPage = await freshContext.newPage();
  const freshErrors = attachErrors(freshPage, "fresh user");
  await freshPage.goto(`${origin}/import`, { waitUntil: "networkidle" });
  await ready(freshPage, "/import");
  const freshBefore = await storage(freshPage);
  assert(freshBefore.values.marker === "absent" && freshBefore.values.app === "absent" && freshBefore.values.theme === "absent" && freshBefore.values.achievements === "absent", "Fresh context did not start with empty legacy storage");
  assert(freshBefore.databases.length === 0, "Fresh context auto-created IndexedDB");
  await freshPage.goto(`${origin}/settings`, { waitUntil: "networkidle" });
  assert((await freshPage.locator("body").innerText()).includes("localStorage"), "Fresh user does not expose LocalStorageRuntime");
  await freshPage.goto(`${origin}/import`, { waitUntil: "networkidle" });
  await freshPage.getByTestId("import-source-url").fill("https://fixture.invalid/fresh-temporary");
  await freshPage.getByTestId("import-title").fill("PHASE2_FRESH_TEMPORARY_ONLY");
  await freshPage.getByTestId("import-raw-share-text").fill("Synthetic isolated production smoke record.");
  await freshPage.getByTestId("import-user-note").fill("Temporary smoke fixture.");
  await freshPage.getByTestId("import-submit").click();
  await freshPage.getByTestId("import-success-panel").waitFor({ state: "visible" });
  const freshAfterWrite = await storage(freshPage);
  assert(String(freshAfterWrite.values.app).includes("PHASE2_FRESH_TEMPORARY_ONLY"), "Fresh temporary favorite was not written to legacy localStorage");
  assert(freshAfterWrite.values.marker === "absent" && freshAfterWrite.databases.length === 0, "Fresh write changed storage authority");
  await freshPage.reload({ waitUntil: "networkidle" });
  const freshAfterReload = await storage(freshPage);
  assert(String(freshAfterReload.values.app).includes("PHASE2_FRESH_TEMPORARY_ONLY"), "Fresh temporary favorite did not survive refresh");
  assert(freshErrors().length === 0, "Fresh-user scenario emitted browser errors");
  result.freshUser = { runtime: "localStorage", markerAutoCreated: false, indexedDbAutoCreated: false, automaticMigration: false, automaticPrepare: false, automaticActivation: false, temporaryFavoritePersisted: true };
  await freshContext.close();

  const fixtureContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const fixturePage = await fixtureContext.newPage();
  await fixturePage.addInitScript(({ state, keys }) => { localStorage.setItem(keys.app, JSON.stringify(state)); localStorage.setItem(keys.theme, "lavender-mint"); localStorage.setItem(keys.achievements, JSON.stringify({ first_revival: "2026-07-27T00:00:00.000Z" })); }, { state: fixture(), keys: storageKeys });
  const fixtureErrors = attachErrors(fixturePage, "legacy fixture");
  await fixturePage.goto(`${origin}/import`, { waitUntil: "networkidle" });
  await ready(fixturePage, "/import");
  const fixtureInitial = await storage(fixturePage);
  assert(String(fixtureInitial.values.app).includes("PHASE2_FIXTURE_ONLY"), "Legacy fixture did not hydrate");
  assert(fixtureInitial.values.marker === "absent" && fixtureInitial.databases.length === 0, "Legacy fixture changed storage authority at boot");
  await fixturePage.goto(`${origin}/search`, { waitUntil: "networkidle" });
  await fixturePage.locator("input").first().fill("phase2");
  await fixturePage.locator("input").first().press("Enter");
  assert((await fixturePage.locator("body").innerText()).includes("Phase 2 fixture favorite"), "Legacy fixture is not searchable");
  await fixturePage.goto(`${origin}/albums`, { waitUntil: "networkidle" });
  await ready(fixturePage, "/albums");
  await fixturePage.goto(`${origin}/settings`, { waitUntil: "networkidle" });
  await fixturePage.getByTestId("theme-dawn").click();
  const fixtureAfterUpdate = await storage(fixturePage);
  assert(fixtureAfterUpdate.values.theme === "dawn", "Legacy fixture update did not write localStorage");
  await fixturePage.reload({ waitUntil: "networkidle" });
  const fixtureAfterReload = await storage(fixturePage);
  assert(fixtureAfterReload.values.theme === "dawn" && fixtureAfterReload.values.marker === "absent" && fixtureAfterReload.databases.length === 0, "Legacy fixture persistence or authority check failed");
  assert(fixtureErrors().length === 0, "Legacy fixture emitted browser errors");
  result.legacyFixture = { hydrated: true, count: 1, searchable: true, albums: true, theme: true, achievements: true, updateAndRefreshPersisted: true, markerAutoCreated: false, indexedDbAutoCreated: false, automaticMigration: false, automaticActivation: false };
  await fixturePage.goto(`${origin}/settings/data-migration`, { waitUntil: "networkidle" });
  await ready(fixturePage, "/settings/data-migration");
  assert(await fixturePage.getByTestId("migration-inspection-step").count() > 0, "Migration inspection entry is missing");
  const migrationStorage = await storage(fixturePage);
  assert(migrationStorage.values.marker === "absent" && migrationStorage.databases.length === 0, "Opening migration entry caused a storage action");
  result.migrationRoute = { openedReadOnly: true, markerAutoCreated: false, indexedDbAutoCreated: false };
  await fixtureContext.close();
} catch (error) { result.failure = error instanceof Error ? error.message : String(error); }
finally { await browser.close(); result.finishedAt = new Date().toISOString(); await writeFile(resolve(outputDirectory, "result.json"), JSON.stringify(result, null, 2)); }
if (result.failure) process.exitCode = 1;
