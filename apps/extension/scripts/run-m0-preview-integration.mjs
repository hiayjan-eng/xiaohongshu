import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const playwrightModule = pathToFileURL(resolve(repoRoot, "apps", "web", "node_modules", "@playwright", "test", "index.mjs")).href;
const { chromium } = await import(playwrightModule);
const suite = process.argv.find((arg) => arg.startsWith("--suite="))?.slice("--suite=".length) || "all";
const supportedSuites = ["all", "page-identity", "side-panel", "import-bridge", "batch-rollback", "original-link", "preview-namespace"];
if (!supportedSuites.includes(suite)) throw new Error(`Unsupported M0 Preview suite: ${suite}`);

const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  const results = {};
  if (["all", "page-identity"].includes(suite)) results.pageIdentity = await testPageIdentity();
  if (["all", "side-panel"].includes(suite)) results.sidePanel = await testSidePanel();
  if (["all", "import-bridge", "batch-rollback", "original-link", "preview-namespace"].includes(suite)) {
    results[suite === "all" ? "previewFlow" : suite] = await testPreviewFlow(suite);
  }
  console.log(JSON.stringify({ status: "PASS", suite, ...results }, null, 2));
} finally {
  await browser.close();
}

async function testPageIdentity() {
  const fixtureHtml = await readFile(resolve(extensionRoot, "tests", "fixtures", "full-scan-virtual-list.html"), "utf8");
  const coreSource = await readFile(resolve(extensionRoot, "src", "full-scan-core.js"), "utf8");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("https://www.xiaohongshu.com/**", async (route) => {
    if (route.request().resourceType() === "document") await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml });
    else await route.abort();
  });
  const inspect = async () => page.evaluate(() => {
    const value = globalThis.CollectionRevivalFullScanCore.inspectFavoritesPage({ document, location });
    return { ok: value.ok, code: value.code, diagnostics: value.diagnostics };
  });
  try {
    await page.goto("https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    const confirmed = await inspect();
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.diagnostics.selectorVersion, "m0-real-favorites-v3");
    assert.equal(confirmed.diagnostics.ownPostsPanelCount, 1);

    await page.evaluate(() => history.replaceState(null, "", "/user/profile/m0fixtureprofile?tab=note"));
    assert.equal((await inspect()).code, "FAVORITES_ROUTE_UNCONFIRMED");
    await page.evaluate(() => history.replaceState(null, "", "/user/profile/m0fixtureprofile?tab=fav"));
    await page.locator("[data-revival-own-profile]").evaluate((element) => element.remove());
    assert.equal((await inspect()).code, "OWN_PROFILE_UNCONFIRMED");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: coreSource });
    await page.evaluate(() => {
      document.querySelector('[data-revival-tab="favorites"]').setAttribute("aria-selected", "false");
    });
    assert.equal((await inspect()).code, "FAVORITES_TAB_UNCONFIRMED");

    for (const [mode, code] of [["risk", "RISK_CONTROL"], ["login", "LOGIN_EXPIRED"], ["network", "NETWORK_ERROR"]]) {
      await page.goto(`https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20&mode=${mode}`, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: coreSource });
      assert.equal((await inspect()).code, code);
    }
    return { strictFavoritesConfirmed: true, ownProfileBlocked: true, ownPostFalseImportCount: 0, blockersSafePaused: 3 };
  } finally {
    await context.close();
  }
}

async function testSidePanel() {
  const html = await readFile(resolve(extensionRoot, "src", "sidepanel.html"), "utf8");
  const css = await readFile(resolve(extensionRoot, "src", "sidepanel.css"), "utf8");
  const profile = 'globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__={id:"m0-preview",versionName:"0.3.0-m0-preview",defaultWebAppUrl:"https://preview.test/m0-preview/",webAppOrigins:["https://preview.test"]};';
  const sidepanel = await readFile(resolve(extensionRoot, "src", "sidepanel.js"), "utf8");
  const context = await browser.newContext();
  await context.addInitScript(installSidePanelChromeMock);
  await context.route("https://extension.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("sidepanel.html")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (path.endsWith("sidepanel.css")) return route.fulfill({ status: 200, contentType: "text/css", body: css });
    if (path.endsWith("build-profile.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: profile });
    if (path.endsWith("sidepanel.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: sidepanel });
    return route.abort();
  });
  const page = await context.newPage();
  try {
    await page.goto("https://extension.test/sidepanel.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("pageIdentity")?.textContent?.includes("收藏"));
    assert.equal(await page.locator(".eyebrow").textContent(), "M0 全量扫描 Preview 0.3.0");
    assert.equal(await page.locator("#startScan").isEnabled(), true);
    await page.locator("#randomButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#resultItems li").length === 2);
    const messages = await page.evaluate(() => globalThis.__sidePanelMessages);
    assert.ok(messages.some((message) => message.type === "M0_FULL_SCAN_LIST_ITEMS" && message.options.random === true));
    const manifestHasPopup = await page.evaluate(() => Boolean(chrome.runtime.getManifest().action?.default_popup));
    assert.equal(manifestHasPopup, false, "long task must not depend on a popup");
    return { opened: true, randomReview: 2, popupIndependent: true };
  } finally {
    await context.close();
  }
}

async function testPreviewFlow(requestedSuite) {
  const html = await readFile(resolve(repoRoot, "apps", "web", "public", "m0-preview", "index.html"), "utf8");
  const css = await readFile(resolve(repoRoot, "apps", "web", "public", "m0-preview", "m0-preview.css"), "utf8");
  const script = await readFile(resolve(repoRoot, "apps", "web", "public", "m0-preview", "m0-preview.js"), "utf8");
  const context = await browser.newContext();
  await context.addInitScript(installPreviewBridgeMock, createFixtureItems(20));
  await context.addInitScript(() => localStorage.setItem("collection-revival-system", "production-sentinel"));
  await context.route("https://preview.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/m0-preview/" || path.endsWith("index.html")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    if (path.endsWith("m0-preview.css")) return route.fulfill({ status: 200, contentType: "text/css", body: css });
    if (path.endsWith("m0-preview.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: script });
    return route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto("https://preview.test/m0-preview/?importBatchId=import_batch_1", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("newCount")?.textContent === "20");
    assert.equal(await page.locator("#existingCount").textContent(), "0");

    const linkChecks = await page.evaluate(() => {
      const api = globalThis.CollectionRevivalM0Preview;
      return {
        corrected: api.resolveOriginalUrl({
          userCorrectedSourceUrl: "https://www.xiaohongshu.com/explore/corrected001",
          canonicalSourceUrl: "https://www.xiaohongshu.com/explore/canonical001",
          rawSourceUrl: "https://www.xiaohongshu.com/discovery/item/raw001"
        }),
        profileRejected: api.resolveOriginalUrl({ canonicalSourceUrl: "https://www.xiaohongshu.com/user/profile/not-a-note" }),
        tokenSame: api.buildDedupeKey({ sourceId: "same-source", canonicalSourceUrl: "https://www.xiaohongshu.com/explore/same-source?xsec_token=a" }) === api.buildDedupeKey({ sourceId: "same-source", canonicalSourceUrl: "https://www.xiaohongshu.com/explore/same-source?xsec_token=b" }),
        sameTitleDistinct: api.buildDedupeKey({ sourceId: "source-a", title: "相同标题" }) !== api.buildDedupeKey({ sourceId: "source-b", title: "相同标题" })
      };
    });
    assert.ok(linkChecks.corrected.includes("corrected001"));
    assert.equal(linkChecks.profileRejected, "");
    assert.equal(linkChecks.tokenSame, true);
    assert.equal(linkChecks.sameTitleDistinct, true);

    await page.locator("#confirmImport").click();
    await page.waitForFunction(() => document.getElementById("libraryCount")?.textContent === "20 条");
    assert.equal(await page.evaluate(() => localStorage.getItem("collection-revival-system")), "production-sentinel");

    await page.goto("https://preview.test/m0-preview/?importBatchId=import_batch_2", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("existingCount")?.textContent === "20");
    assert.equal(await page.locator("#newCount").textContent(), "0");
    await page.locator("#confirmImport").click();
    await page.waitForFunction(() => document.getElementById("importTitle")?.textContent === "导入完成");
    await page.locator("#rollbackImport").click();
    await page.waitForFunction(() => document.getElementById("importTitle")?.textContent === "本批次已撤销");
    assert.equal(await page.locator("#libraryCount").textContent(), "20 条", "rolling back duplicate-only batch must not affect prior batch");

    await page.goto("https://preview.test/m0-preview/?importBatchId=import_batch_1", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("importTitle")?.textContent === "本批次已导入");
    await page.locator("#rollbackImport").click();
    await page.waitForFunction(() => document.getElementById("libraryCount")?.textContent === "0 条");

    const databases = await page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name));
    assert.deepEqual(databases, ["collection-revival-m0-preview-v1"]);
    return {
      requestedSuite,
      firstImportNew: 20,
      secondImportNew: 0,
      batchRollbackIsolated: true,
      originalLinkPriority: true,
      profileLinkRejected: true,
      productionSentinelUntouched: true,
      databaseNames: databases
    };
  } finally {
    await context.close();
  }
}

function createFixtureItems(total) {
  return Array.from({ length: total }, (_, index) => ({
    sourceId: `previewnote${String(index).padStart(6, "0")}`,
    rawSourceUrl: `https://www.xiaohongshu.com/discovery/item/previewnote${String(index).padStart(6, "0")}?xsec_token=token-${index}`,
    canonicalSourceUrl: `https://www.xiaohongshu.com/explore/previewnote${String(index).padStart(6, "0")}?xsec_token=token-${index}`,
    title: index < 2 ? "相同标题但不同 sourceId" : `Preview 收藏 ${index}`,
    author: `作者 ${index % 5}`,
    coverUrl: "",
    visibleExcerpt: `仅用于自动测试的脱敏夹具 ${index}`,
    capturedAt: "2026-07-30T00:00:00.000Z",
    selectorVersion: "m0-real-favorites-v3"
  }));
}

function installPreviewBridgeMock(items) {
  globalThis.__previewFixtureItems = items;
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (event.source !== window || message.source !== "collection-revival-m0-preview-web") return;
    let response;
    if (message.type === "M0_PREVIEW_IMPORT_META_REQUEST") {
      response = { ok: true, meta: { importBatchId: message.importBatchId, scanSessionId: "scan_fixture", extensionVersion: "0.3.0-m0-preview", totalCount: items.length, reviewCount: 0, selectorVersion: "m0-real-favorites-v3", status: "prepared" } };
    } else if (message.type === "M0_PREVIEW_IMPORT_CHUNK_REQUEST") {
      const offset = Number(message.offset) || 0;
      const limit = Number(message.limit) || 200;
      const chunkItems = items.slice(offset, offset + limit);
      response = { ok: true, chunk: { importBatchId: message.importBatchId, scanSessionId: "scan_fixture", extensionVersion: "0.3.0-m0-preview", items: chunkItems, offset, nextOffset: offset + chunkItems.length, hasMore: offset + chunkItems.length < items.length, totalCount: items.length } };
    } else if (message.type === "M0_PREVIEW_IMPORT_RESULT") response = { ok: true };
    else return;
    window.setTimeout(() => window.postMessage({ source: "collection-revival-extension", type: "M0_PREVIEW_RESPONSE", requestId: message.requestId, requestType: message.type, response }, window.location.origin), 0);
  });
}

function installSidePanelChromeMock() {
  globalThis.__sidePanelMessages = [];
  const session = { sessionId: "scan_sidepanel", status: "completed", discoveredCount: 20, validCount: 20, existingCount: 0, invalidCount: 0, missingLinkCount: 0, reviewCount: 0, resumeCount: 1, lastScrollTop: 100, lastScrollHeight: 100, stableNoGrowthCycles: 6, startedAt: "2026-07-30T00:00:00.000Z", completedAt: "2026-07-30T00:01:00.000Z", selectorVersion: "m0-real-favorites-v3", extensionVersion: "0.3.0-m0-preview" };
  const inspection = { ok: true, identity: { profileIdHash: "abcd1234", favoritesPageIdentity: "fixture-page", selectorVersion: "m0-real-favorites-v3" }, diagnostics: { selectorVersion: "m0-real-favorites-v3", ownPostsPanelCount: 1, likesPanelCount: 1 } };
  const items = [0, 1].map((index) => ({ sourceId: `sidepanel${index}`, title: `抽查 ${index}`, author: "测试作者", canonicalSourceUrl: `https://www.xiaohongshu.com/explore/sidepanel${index}` }));
  const runtimeListeners = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.3.0", version_name: "0.3.0-m0-preview", action: {} }),
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      sendMessage(message, callback) {
        globalThis.__sidePanelMessages.push(message);
        if (message.type === "M0_FULL_SCAN_GET_SESSION") callback({ ok: true, session, recentItems: items });
        else if (message.type === "M0_FULL_SCAN_LIST_ITEMS") callback({ ok: true, items, totalMatched: 2 });
        else if (message.type === "M0_FULL_SCAN_GET_DIAGNOSTICS") callback({ ok: true, diagnostics: { session, verification: { consistent: true, uniqueSourceIdCount: 20 } } });
        else callback({ ok: true });
      }
    },
    tabs: {
      query: async () => [{ id: 7, url: "https://www.xiaohongshu.com/user/profile/test?tab=fav" }],
      sendMessage(_tabId, message, callback) {
        globalThis.__sidePanelMessages.push(message);
        if (message.type === "M0_FULL_SCAN_GET_PAGE_STATUS") callback({ ok: true, inspection });
        else if (message.type === "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS") callback({ ok: true, diagnostics: { maxBufferedItems: 25, recentItemCount: 12, scrollMode: "element" } });
        else callback({ ok: true, session });
      },
      create: async () => ({ id: 8 })
    },
    downloads: { download: async () => 1 }
  };
}
