import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const productionUrl = "https://xiaohongshu-green.vercel.app";
const reportPath = resolve("docs/phase2-smoke-result.json");
const screenshotDirectory = resolve("docs/phase2-smoke-screenshots");
const storageKeys = {
  app: "collection-revival-system:v1",
  marker: "collection-revival-storage-bootstrap:v1",
  theme: "collection-revival-theme",
  achievements: "collection-revival-achievements"
};
const routes = ["/", "/import", "/albums", "/search", "/settings", "/settings/data-migration"];
const fixtureToken = "PHASE2_SMOKE_FIXTURE_ONLY";
const temporaryToken = "PHASE2_TEMPORARY_FAVORITE_ONLY";
const result = {
  productionUrl,
  startedAt: new Date().toISOString(),
  chromiumVersion: "",
  routes: [],
  freshUser: {},
  legacyFixture: {},
  errors: [],
  screenshots: []
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function attachErrorCollection(page, scope) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|404 \(Not Found\)|Failed to load resource:.*404/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return () => {
    if (errors.length) result.errors.push({ scope, errors });
    return errors;
  };
}

async function inspectStorage(page) {
  return page.evaluate((keys) => {
    const read = (key) => window.localStorage.getItem(key);
    return {
      marker: read(keys.marker),
      app: read(keys.app),
      theme: read(keys.theme),
      achievements: read(keys.achievements),
      indexedDbDatabasesSupported: typeof indexedDB.databases === "function",
      indexedDbDatabases: typeof indexedDB.databases === "function" ? indexedDB.databases() : []
    };
  }, storageKeys).then(async (snapshot) => ({ ...snapshot, indexedDbDatabases: await snapshot.indexedDbDatabases }));
}

function legacyFixture() {
  const now = "2026-07-27T00:00:00.000Z";
  const item = {
    id: "phase2-fixture-item-001",
    userId: "phase2-fixture-user",
    sourcePlatform: "fixture",
    sourceUrl: "https://fixture.invalid/phase2-smoke",
    rawShareText: fixtureToken,
    rawTitle: "Phase 2 fixture favorite",
    cleanedTitle: "Phase 2 fixture favorite",
    displayTitle: "Phase 2 fixture favorite",
    textNormalizationVersion: 3,
    title: "Phase 2 fixture favorite",
    userNote: "Synthetic isolated test data only",
    contentDomain: "AI 与效率",
    contentSubDomain: "工具",
    savedIntent: "想学习",
    secondaryIntents: [],
    confidence: "high",
    whyThisDomain: "Synthetic fixture",
    whyThisIntent: "Synthetic fixture",
    category: "AI 与效率",
    subCategory: "工具",
    classificationConfidence: "high",
    intent: "学习",
    whyThisCategory: "Synthetic fixture",
    summary: "Synthetic fixture favorite for production smoke testing.",
    keywords: ["phase2", "fixture"],
    entities: [],
    searchableText: `phase2 fixture ${fixtureToken}`,
    status: "not_started",
    createdAt: now,
    updatedAt: now
  };
  return {
    schemaVersion: 3,
    user: { id: "phase2-fixture-user", name: "Phase 2 Fixture", email: "fixture@example.invalid", createdAt: now },
    savedItems: [item], actionCards: [], planCards: [], classificationCorrections: [], searchLogs: [], smartAlbums: [], importBatches: [], importBatchItems: []
  };
}

async function newIsolatedContext(browser, label) {
  const profile = await mkdtemp(join(tmpdir(), `phase2-${label}-`));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { context, profile };
}

async function closeIsolatedContext(context, profile) {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

async function run() {
  await mkdir(screenshotDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  result.chromiumVersion = browser.version();
  try {
    const routeSession = await newIsolatedContext(browser, "routes");
    try {
      const page = await routeSession.context.newPage();
      for (const path of routes) {
        const collectErrors = attachErrorCollection(page, `route ${path}`);
        const response = await page.goto(`${productionUrl}${path}`, { waitUntil: "networkidle" });
        assert(response?.ok(), `Route ${path} did not return a successful response`);
        assert(await page.locator(".app-shell").count() > 0, `Route ${path} did not render .app-shell`);
        assert((await page.locator("body").innerText()).trim().length > 0, `Route ${path} rendered a blank body`);
        await page.reload({ waitUntil: "networkidle" });
        assert(await page.locator(".app-shell").count() > 0, `Route ${path} lost .app-shell after refresh`);
        const errors = collectErrors();
        assert(errors.length === 0, `Route ${path} emitted browser errors: ${errors.join(" | ")}`);
        result.routes.push({ path, responseStatus: response.status(), refreshed: true, appShell: true, errors });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${productionUrl}/`, { waitUntil: "networkidle" });
      const desktopScreenshot = join(screenshotDirectory, "phase2-production-desktop.png");
      await page.screenshot({ path: desktopScreenshot, fullPage: true });
      result.screenshots.push(desktopScreenshot);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${productionUrl}/import`, { waitUntil: "networkidle" });
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      assert(dimensions.scrollWidth <= dimensions.clientWidth, `Mobile import page has horizontal overflow: ${JSON.stringify(dimensions)}`);
      const mobileScreenshot = join(screenshotDirectory, "phase2-production-mobile.png");
      await page.screenshot({ path: mobileScreenshot, fullPage: true });
      result.screenshots.push(mobileScreenshot);
      result.mobile = dimensions;
    } finally { await closeIsolatedContext(routeSession.context, routeSession.profile); }

    const freshSession = await newIsolatedContext(browser, "fresh");
    try {
      const page = await freshSession.context.newPage();
      const initial = await page.goto(`${productionUrl}/`, { waitUntil: "networkidle" });
      assert(initial?.ok(), "Fresh-user production page failed to load");
      const before = await inspectStorage(page);
      assert(before.marker === null && before.app === null && before.theme === null && before.achievements === null, "Fresh context was not empty before verification");
      assert(before.indexedDbDatabases.length === 0, "Fresh context already contains IndexedDB databases");
      assert(await page.locator(".app-shell").count() > 0, "Fresh user did not receive app shell");
      assert((await page.locator("body").innerText()).includes("localStorage"), "Fresh user does not present the localStorage runtime");
      assert(!/recovery|恢复|修复/.test(await page.locator("body").innerText()), "Fresh user unexpectedly rendered a recovery screen");
      const afterBoot = await inspectStorage(page);
      assert(afterBoot.marker === null, "Fresh-user boot auto-created a Bootstrap Marker");
      assert(afterBoot.indexedDbDatabases.length === 0, "Fresh-user boot auto-created IndexedDB");
      await page.goto(`${productionUrl}/import`, { waitUntil: "networkidle" });
      await page.getByTestId("import-source-url").fill("https://fixture.invalid/phase2-temporary-favorite");
      await page.getByTestId("import-title").fill(temporaryToken);
      await page.getByTestId("import-raw-share-text").fill("Synthetic temporary favorite created in an isolated smoke-test context.");
      await page.getByTestId("import-user-note").fill("Temporary smoke test only.");
      await page.getByTestId("quick-import-form").evaluate((form) => form.requestSubmit());
      await page.getByTestId("import-success-panel").waitFor();
      const afterWrite = await inspectStorage(page);
      assert(afterWrite.app?.includes(temporaryToken), "Temporary favorite was not persisted to legacy localStorage");
      assert(afterWrite.marker === null && afterWrite.indexedDbDatabases.length === 0, "Creating a temporary favorite changed storage authority");
      await page.reload({ waitUntil: "networkidle" });
      const afterReload = await inspectStorage(page);
      assert(afterReload.app?.includes(temporaryToken), "Temporary favorite did not survive refresh");
      assert(afterReload.marker === null && afterReload.indexedDbDatabases.length === 0, "Refresh changed storage authority");
      result.freshUser = { initialEmpty: true, runtime: "localStorage", markerAutoCreated: false, indexedDbAutoCreated: false, automaticMigration: false, automaticActivation: false, temporaryFavoritePersisted: true };
    } finally { await closeIsolatedContext(freshSession.context, freshSession.profile); }

    const fixtureSession = await newIsolatedContext(browser, "fixture");
    try {
      const page = await fixtureSession.context.newPage();
      const fixture = legacyFixture();
      await page.addInitScript(({ keys, fixture }) => {
        window.localStorage.setItem(keys.app, JSON.stringify(fixture));
        window.localStorage.setItem(keys.theme, "lavender-mint");
        window.localStorage.setItem(keys.achievements, JSON.stringify({ first_revival: "2026-07-27T00:00:00.000Z" }));
      }, { keys: storageKeys, fixture });
      const collectErrors = attachErrorCollection(page, "legacy fixture");
      const response = await page.goto(`${productionUrl}/`, { waitUntil: "networkidle" });
      assert(response?.ok(), "Legacy fixture production page failed to load");
      assert(await page.locator(".app-shell").count() > 0, "Legacy fixture did not hydrate app shell");
      assert((await page.locator("body").innerText()).includes("Phase 2 fixture favorite"), "Legacy fixture favorite did not render");
      await page.goto(`${productionUrl}/search`, { waitUntil: "networkidle" });
      const searchInput = page.locator("input").first();
      await searchInput.fill("phase2");
      await searchInput.press("Enter");
      assert((await page.locator("body").innerText()).includes("Phase 2 fixture favorite"), "Search did not find legacy fixture favorite");
      await page.goto(`${productionUrl}/albums`, { waitUntil: "networkidle" });
      assert(await page.locator(".app-shell").count() > 0, "Albums page failed for legacy fixture");
      await page.goto(`${productionUrl}/settings`, { waitUntil: "networkidle" });
      const beforeCrud = await inspectStorage(page);
      await page.getByTestId("theme-dawn").click();
      const afterCrud = await inspectStorage(page);
      assert(afterCrud.theme === "dawn", "Legacy fixture mutation did not persist to localStorage");
      await page.reload({ waitUntil: "networkidle" });
      const afterCrudReload = await inspectStorage(page);
      assert(afterCrudReload.theme === "dawn", "Legacy fixture CRUD did not survive refresh");
      assert(afterCrudReload.marker === null && afterCrudReload.indexedDbDatabases.length === 0, "Legacy fixture changed storage authority");
      await page.goto(`${productionUrl}/settings/data-migration`, { waitUntil: "networkidle" });
      assert(await page.locator(".app-shell").count() > 0, "Data-migration route failed to render");
      assert(await page.getByTestId("migration-inspection-step").count() > 0, "Data-migration inspection entry is missing");
      const afterMigrationPage = await inspectStorage(page);
      assert(afterMigrationPage.marker === null && afterMigrationPage.indexedDbDatabases.length === 0, "Opening data-migration route performed an automatic storage action");
      const errors = collectErrors();
      assert(errors.length === 0, `Legacy fixture emitted browser errors: ${errors.join(" | ")}`);
      result.legacyFixture = { hydrated: true, count: 1, searchable: true, albumsRoute: true, themeAndAchievements: true, legacyCrudAndRefresh: true, markerAutoCreated: false, indexedDbAutoCreated: false, automaticMigration: false, automaticActivation: false, migrationRouteReadOnly: true };
    } finally { await closeIsolatedContext(fixtureSession.context, fixtureSession.profile); }
  } finally {
    await browser.close();
    result.finishedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(result, null, 2));
  }
}

run().catch(async (error) => {
  result.failure = error instanceof Error ? error.message : String(error);
  result.finishedAt = new Date().toISOString();
  await mkdir(resolve("docs"), { recursive: true });
  await writeFile(reportPath, JSON.stringify(result, null, 2));
  console.error(result.failure);
  process.exitCode = 1;
});
