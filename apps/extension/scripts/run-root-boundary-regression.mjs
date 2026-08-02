import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const playwrightModule = pathToFileURL(resolve(repoRoot, "apps", "web", "node_modules", "@playwright", "test", "index.mjs")).href;
const { chromium } = await import(playwrightModule);
const fixtureHtml = await readFile(resolve(extensionRoot, "tests", "fixtures", "full-scan-root-boundary.html"), "utf8");
const scriptPaths = [
  resolve(extensionRoot, "src", "full-scan-idb.js"),
  resolve(extensionRoot, "src", "full-scan-core.js"),
  resolve(extensionRoot, "src", "full-scan-content.js")
];

const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  const activePanel = await verifyActivePanelAndRootReplacement();
  const firstBatchGate = await verifyFirstBatchGate();
  const discard = await verifyContaminatedSessionDiscard();
  console.log(JSON.stringify({ status: "PASS", activePanel, firstBatchGate, discard }, null, 2));
} finally {
  await browser.close();
}

async function verifyActivePanelAndRootReplacement() {
  const context = await browser.newContext();
  await context.addInitScript(installChromeBridge, { corruptAfterCreate: false });
  const page = await openFixture(context);
  try {
    await installScripts(page, scriptPaths);
    const inspection = await page.evaluate(() => {
      const value = globalThis.CollectionRevivalFullScanCore.inspectFavoritesPage({ document, location });
      return {
        ok: value.ok,
        code: value.code,
        rootId: value.root?.id || "",
        rootAssociation: value.diagnostics?.rootAssociation,
        activePanel: value.diagnostics?.activePanelSelector
      };
    });
    assert.equal(inspection.ok, true, JSON.stringify(inspection));
    assert.equal(inspection.rootId, "favoritesFeeds");
    assert.equal(inspection.rootAssociation, "active-transform-tab-content");

    const started = await sendToContent(page, { type: "M0_FULL_SCAN_START" });
    assert.equal(started.ok, true);
    await page.evaluate(() => globalThis.__M0_ROOT_BOUNDARY_FIXTURE__.replaceFavoritesRoot());
    const completed = await waitForTerminalSession(page, started.session.sessionId, 20_000);
    assert.equal(completed.status, "completed");
    assert.equal(completed.validCount, 80);
    const [listed, runtime, fixture] = await Promise.all([
      page.evaluate((sessionId) => globalThis.CollectionRevivalFullScanDb.listSessionItems(sessionId, { limit: 100 }), started.session.sessionId),
      sendToContent(page, { type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS" }),
      page.evaluate(() => ({ rootReplacementCount: globalThis.__M0_ROOT_BOUNDARY_FIXTURE__.rootReplacementCount }))
    ]);
    assert.equal(listed.items.length, 80);
    assert.ok(listed.items.every((item) => item.sourceId.startsWith("favorite")));
    assert.equal(listed.items.some((item) => item.sourceId.startsWith("posted")), false);
    assert.equal(fixture.rootReplacementCount, 1);
    assert.ok(runtime.diagnostics.rootRebindCount >= 1);
    return {
      simultaneousPanels: "favorites-only",
      stalePostedPanelIgnored: true,
      rootReplacementCount: runtime.diagnostics.rootRebindCount,
      persistedFavorites: completed.validCount,
      persistedOwnPosts: 0
    };
  } finally {
    await context.close();
  }
}

async function verifyFirstBatchGate() {
  const context = await browser.newContext();
  await context.addInitScript(installChromeBridge, { corruptAfterCreate: true });
  const page = await openFixture(context);
  try {
    await installScripts(page, scriptPaths);
    const started = await sendToContent(page, { type: "M0_FULL_SCAN_START" });
    assert.equal(started.ok, false);
    assert.equal(started.session.status, "contaminated");
    assert.equal(started.session.validCount, 0);
    const diagnostics = await page.evaluate((sessionId) => globalThis.CollectionRevivalFullScanDb.getDiagnostics(sessionId), started.session.sessionId);
    const itemCount = await countStore(page, "favoriteItems");
    assert.equal(diagnostics.verification.validRelationCount, 0);
    assert.equal(itemCount, 0);
    assert.ok(["FAVORITES_PANEL_NOT_FOUND", "ACTIVE_FAVORITES_ROOT_CHANGED"].includes(started.session.lastErrorCode));
    return { wrongRootCards: 32, persistedItems: itemCount, terminalStatus: started.session.status };
  } finally {
    await context.close();
  }
}

async function verifyContaminatedSessionDiscard() {
  const context = await browser.newContext();
  const page = await openFixture(context);
  try {
    await page.addScriptTag({ path: scriptPaths[0] });
    const result = await page.evaluate(async () => {
      const Db = globalThis.CollectionRevivalFullScanDb;
      const baseIdentity = {
        profileIdHash: "abcdef12",
        favoritesPageIdentity: "root-boundary-discard-fixture",
        selectorVersion: "m0-real-favorites-v4",
        extensionVersion: "0.3.2-m0-preview"
      };
      const makeItems = (prefix, count) => Array.from({ length: count }, (_, index) => {
        const sourceId = `${prefix}${String(index).padStart(8, "0")}`;
        return {
          sourceId,
          rawSourceUrl: `https://www.xiaohongshu.com/explore/${sourceId}`,
          canonicalSourceUrl: `https://www.xiaohongshu.com/explore/${sourceId}`,
          title: `${prefix} title ${index}`,
          author: `${prefix} author`,
          capturedAt: new Date().toISOString()
        };
      });
      const persistAll = async (sessionId, items) => {
        for (let offset = 0; offset < items.length; offset += 100) await Db.persistItems(sessionId, items.slice(offset, offset + 100));
      };

      const existingSession = await Db.createSession(baseIdentity, { resume: false });
      await Db.updateSession(existingSession.sessionId, { status: "scanning" });
      await persistAll(existingSession.sessionId, makeItems("existing", 190));
      await Db.updateSession(existingSession.sessionId, { status: "completed", completedAt: new Date().toISOString() });

      const contaminatedIdentity = {
        ...baseIdentity,
        selectorVersion: "m0-real-favorites-v5",
        extensionVersion: "0.3.3-m0-preview"
      };
      const unsafeSession = await Db.createSession(contaminatedIdentity, { resume: false });
      await Db.updateSession(unsafeSession.sessionId, { status: "scanning" });
      await persistAll(unsafeSession.sessionId, makeItems("posted", 32));
      const quarantined = await Db.createSession({
        ...baseIdentity,
        selectorVersion: "m0-real-favorites-v6",
        extensionVersion: "0.3.4-m0-preview"
      }, { resume: true });
      const discarded = await Db.discardContaminatedSession(quarantined.sessionId, baseIdentity.favoritesPageIdentity);
      const cleanSession = await Db.createSession({
        ...baseIdentity,
        selectorVersion: "m0-real-favorites-v6",
        extensionVersion: "0.3.4-m0-preview"
      }, { resume: false });
      const database = await Db.openDatabase();
      const count = (storeName) => new Promise((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const remainingItems = await Db.listSessionItems(existingSession.sessionId, { limit: 200 });
      const discardedRelations = await Db.listSessionItems(unsafeSession.sessionId, { limit: 100 });
      return {
        quarantinedStatus: quarantined.status,
        deletedItemCount: discarded.deletedItemCount,
        preservedExistingItemCount: discarded.preservedExistingItemCount,
        favoriteItemCount: await count("favoriteItems"),
        existingRelationCount: remainingItems.totalMatched,
        discardedRelationCount: discardedRelations.totalMatched,
        cleanSessionStatus: cleanSession.status
      };
    });
    assert.equal(result.quarantinedStatus, "contaminated");
    assert.equal(result.deletedItemCount, 32);
    assert.equal(result.preservedExistingItemCount, 0);
    assert.equal(result.favoriteItemCount, 190);
    assert.equal(result.existingRelationCount, 190);
    assert.equal(result.discardedRelationCount, 0);
    assert.equal(result.cleanSessionStatus, "ready");
    return result;
  } finally {
    await context.close();
  }
}

async function openFixture(context) {
  const page = await context.newPage();
  await page.route("https://www.xiaohongshu.com/**", async (route) => {
    if (route.request().resourceType() === "document") await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml });
    else await route.abort();
  });
  await page.goto("https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note", { waitUntil: "domcontentloaded" });
  return page;
}

async function installScripts(page, paths) {
  for (const path of paths) await page.addScriptTag({ path });
}

async function sendToContent(page, message) {
  return page.evaluate((payload) => globalThis.__sendM0MessageToContent(payload), message);
}

async function waitForTerminalSession(page, sessionId, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const session = await page.evaluate((id) => globalThis.CollectionRevivalFullScanDb.getSession(id), sessionId);
    if (["completed", "paused", "needs_user", "stopped", "contaminated"].includes(session?.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for terminal session ${sessionId}`);
}

async function countStore(page, storeName) {
  return page.evaluate(async (name) => {
    const database = await globalThis.CollectionRevivalFullScanDb.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(name, "readonly").objectStore(name).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, storeName);
}

function installChromeBridge(options) {
  globalThis.__M0_FULL_SCAN_TEST_MODE__ = true;
  const listeners = [];
  let corrupted = false;
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.3.4", version_name: "0.3.4-m0-preview" }),
      onMessage: { addListener(listener) { listeners.push(listener); } },
      sendMessage(message, callback) {
        if (message?.type === "M0_FULL_SCAN_PROGRESS") return void callback?.({ ok: true });
        Promise.resolve(globalThis.CollectionRevivalFullScanDb.handleMessage(message))
          .then((response) => {
            if (options.corruptAfterCreate && !corrupted && message?.type === "M0_FULL_SCAN_CREATE_SESSION") {
              corrupted = true;
              globalThis.__M0_ROOT_BOUNDARY_FIXTURE__.corruptBeforeFirstPersist();
            }
            callback?.(response);
          })
          .catch((error) => callback?.({ ok: false, error: error.message }));
      }
    }
  };
  globalThis.__sendM0MessageToContent = (message) => new Promise((resolve) => {
    let settled = false;
    const sendResponse = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    for (const listener of listeners) {
      const keepChannelOpen = listener(message, {}, sendResponse);
      if (keepChannelOpen !== true && settled) return;
    }
  });
}
