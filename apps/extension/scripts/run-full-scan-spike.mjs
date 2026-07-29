import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const playwrightModule = pathToFileURL(
  resolve(repoRoot, "apps", "web", "node_modules", "@playwright", "test", "index.mjs")
).href;
const { chromium } = await import(playwrightModule);

const fixtureHtml = await readFile(
  resolve(extensionRoot, "tests", "fixtures", "full-scan-virtual-list.html"),
  "utf8"
);
const scriptPaths = [
  resolve(extensionRoot, "src", "full-scan-idb.js"),
  resolve(extensionRoot, "src", "full-scan-core.js"),
  resolve(extensionRoot, "src", "full-scan-content.js")
];

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext();
await context.addInitScript(installChromeFixtureBridge);

const page = await context.newPage();
await page.route("https://www.xiaohongshu.com/**", async (route) => {
  if (route.request().resourceType() === "document") {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml });
  } else {
    await route.abort();
  }
});

const startedAt = performance.now();
const cdp = await context.newCDPSession(page);
const heapBefore = await cdp.send("Runtime.getHeapUsage");

try {
  await openFixture(page, { total: 3000 });
  await page.evaluate(async () => {
    sessionStorage.clear();
    await globalThis.CollectionRevivalFullScanDb.clearDatabaseForTests();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await installExtensionScripts(page);

  const pageStatus = await sendToContent(page, { type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
  assert.equal(pageStatus.ok, true);
  assert.equal(pageStatus.inspection.ok, true);
  assert.equal(pageStatus.inspection.root, undefined, "DOM roots must not cross the extension message boundary");
  const identity = pageStatus.inspection.identity;
  assert.match(identity.profileIdHash, /^[a-f0-9]{8}$/);

  const started = await sendToContent(page, {
    type: "M0_FULL_SCAN_START",
    debugPauseAfter: 1200
  });
  assert.equal(started.ok, true);
  const sessionId = started.session.sessionId;
  await waitForSessionStatus(page, sessionId, "paused");
  const pausedSession = await getSession(page, sessionId);
  assert.ok(pausedSession.validCount >= 1200 && pausedSession.validCount < 3000);
  assert.equal(pausedSession.status, "paused");

  const runtimeBeforeReload = await sendToContent(page, {
    type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS"
  });
  assert.equal(runtimeBeforeReload.ok, true);
  assert.equal(runtimeBeforeReload.diagnostics.observedRootIsBody, false);
  assert.equal(runtimeBeforeReload.diagnostics.scrollContainerIsInsideFavoritesRoot, true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await installExtensionScripts(page);
  const resumed = await sendToContent(page, { type: "M0_FULL_SCAN_RESUME" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.session.sessionId, sessionId, "resume must keep the same ScanSession");
  await waitForSessionStatus(page, sessionId, "completed", 30_000);

  const finalSession = await getSession(page, sessionId);
  const databaseDiagnostics = await page.evaluate(
    (id) => globalThis.CollectionRevivalFullScanDb.getDiagnostics(id),
    sessionId
  );
  const runtimeAfterResume = await sendToContent(page, {
    type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS"
  });
  const fixture = await page.evaluate(() => ({
    total: globalThis.__M0_FULL_SCAN_FIXTURE__.total,
    loaded: globalThis.__M0_FULL_SCAN_FIXTURE__.loaded,
    loadRequests: globalThis.__M0_FULL_SCAN_FIXTURE__.loadRequests,
    maxDomCards: globalThis.__M0_FULL_SCAN_FIXTURE__.maxDomCards,
    currentDomCards: globalThis.__M0_FULL_SCAN_FIXTURE__.currentDomCards,
    ownPostCardCount: globalThis.__M0_FULL_SCAN_FIXTURE__.ownPostCardCount,
    supportedTotals: globalThis.__M0_FULL_SCAN_FIXTURE__.supportedTotals
  }));
  const storedItems = await listStoredItems(page, identity.favoritesPageIdentity);

  assert.equal(finalSession.discoveredCount, 3000);
  assert.equal(finalSession.validCount, 3000);
  assert.equal(finalSession.invalidCount, 0);
  assert.equal(finalSession.newItemCount, 3000);
  assert.equal(finalSession.duplicateInsertCount, 0);
  assert.equal(finalSession.status, "completed");
  assert.ok(finalSession.stableNoGrowthCycles >= 5);
  assert.equal(databaseDiagnostics.verification.consistent, true);
  assert.equal(databaseDiagnostics.verification.uniqueSourceIdCount, 3000);
  assert.equal(storedItems.length, 3000);
  assert.equal(storedItems.filter((item) => item.sourceId.startsWith("ownpost")).length, 0);
  assert.equal(new Set(storedItems.map((item) => item.sourceId)).size, 3000);
  assert.equal(fixture.loaded, 3000);
  assert.ok(fixture.maxDomCards <= 61, `virtual DOM retained ${fixture.maxDomCards} cards`);
  assert.equal(fixture.ownPostCardCount, 50);
  assert.ok(fixture.loadRequests >= 59);
  assert.deepEqual(fixture.supportedTotals, [20, 100, 500, 1000, 3000, 5000]);
  assert.ok(runtimeAfterResume.diagnostics.maxBufferedItems <= 61);
  assert.ok(runtimeAfterResume.diagnostics.recentItemCount <= 12);

  await verifyBlockingFixture(context, fixtureHtml, scriptPaths, "risk", "RISK_CONTROL");
  await verifyBlockingFixture(context, fixtureHtml, scriptPaths, "login", "LOGIN_EXPIRED");
  await verifyBlockingFixture(context, fixtureHtml, scriptPaths, "network", "NETWORK_ERROR");
  await verifyFiveThousandFixtureCapability(context, fixtureHtml, scriptPaths);

  const heapAfter = await cdp.send("Runtime.getHeapUsage");
  const result = {
    status: "PASS",
    total: 3000,
    discoveredCount: finalSession.discoveredCount,
    validCount: finalSession.validCount,
    ownPostFalseImportCount: 0,
    duplicateInsertCount: finalSession.duplicateInsertCount,
    interruptedAt: pausedSession.validCount,
    resumedFinalCount: finalSession.validCount,
    virtualList: {
      loaded: fixture.loaded,
      maxDomCards: fixture.maxDomCards,
      loadRequests: fixture.loadRequests
    },
    boundedRuntimeState: {
      maxBufferedItems: runtimeAfterResume.diagnostics.maxBufferedItems,
      recentItemCount: runtimeAfterResume.diagnostics.recentItemCount
    },
    runtimeMs: Math.round(performance.now() - startedAt),
    browserHeap: {
      beforeMiB: toMiB(heapBefore.usedSize),
      afterMiB: toMiB(heapAfter.usedSize),
      deltaMiB: toMiB(heapAfter.usedSize - heapBefore.usedSize)
    },
    completionGate: {
      stableNoGrowthCycles: finalSession.stableNoGrowthCycles,
      finalDedupeConsistent: databaseDiagnostics.verification.consistent
    }
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

async function openFixture(targetPage, { total = 3000, mode = "normal" } = {}) {
  await targetPage.goto(
    `https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=${total}&mode=${mode}`,
    { waitUntil: "domcontentloaded" }
  );
  await installExtensionScripts(targetPage);
}

async function installExtensionScripts(targetPage) {
  for (const path of scriptPaths) await targetPage.addScriptTag({ path });
}

async function sendToContent(targetPage, message) {
  return targetPage.evaluate((payload) => globalThis.__sendM0MessageToContent(payload), message);
}

async function getSession(targetPage, sessionId) {
  return targetPage.evaluate(
    (id) => globalThis.CollectionRevivalFullScanDb.getSession(id),
    sessionId
  );
}

async function waitForSessionStatus(targetPage, sessionId, expectedStatus, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const session = await getSession(targetPage, sessionId);
    if (session?.status === expectedStatus) return session;
    if (["completed", "paused", "needs_user", "stopped"].includes(session?.status) && session.status !== expectedStatus) {
      throw new Error(`Expected session ${expectedStatus}, got ${session.status}: ${session.lastErrorMessage || "no reason"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const session = await getSession(targetPage, sessionId);
  throw new Error(`Timed out waiting for ${expectedStatus}; last status was ${session?.status || "missing"}`);
}

async function listStoredItems(targetPage, favoritesPageIdentity) {
  return targetPage.evaluate(async (identity) => {
    const database = await globalThis.CollectionRevivalFullScanDb.openDatabase();
    const transaction = database.transaction("favoriteItems", "readonly");
    const request = transaction.objectStore("favoriteItems").index("favoritesPageIdentity").getAll(identity);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, favoritesPageIdentity);
}

async function verifyBlockingFixture(parentContext, html, paths, mode, expectedCode) {
  const targetPage = await parentContext.newPage();
  await targetPage.route("https://www.xiaohongshu.com/**", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    } else {
      await route.abort();
    }
  });
  await targetPage.goto(
    `https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=20&mode=${mode}`,
    { waitUntil: "domcontentloaded" }
  );
  for (const path of paths) await targetPage.addScriptTag({ path });
  const status = await sendToContent(targetPage, { type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
  assert.equal(status.ok, true);
  assert.equal(status.inspection.ok, false);
  assert.equal(status.inspection.code, expectedCode);
  const start = await sendToContent(targetPage, { type: "M0_FULL_SCAN_START" });
  assert.equal(start.ok, false);
  await targetPage.close();
}

async function verifyFiveThousandFixtureCapability(parentContext, html, paths) {
  const targetPage = await parentContext.newPage();
  await targetPage.route("https://www.xiaohongshu.com/**", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    } else {
      await route.abort();
    }
  });
  await targetPage.goto(
    "https://www.xiaohongshu.com/user/profile/m0fixture5000?tab=fav&subTab=note&total=5000",
    { waitUntil: "domcontentloaded" }
  );
  for (const path of paths) await targetPage.addScriptTag({ path });
  const status = await sendToContent(targetPage, { type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
  assert.equal(status.inspection.ok, true);
  const fixture = await targetPage.evaluate(() => globalThis.__M0_FULL_SCAN_FIXTURE__.total);
  assert.equal(fixture, 5000);
  await targetPage.close();
}

function installChromeFixtureBridge() {
  globalThis.__M0_FULL_SCAN_TEST_MODE__ = true;
  const listeners = [];
  globalThis.__m0ProgressEvents = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest() {
        return { version: "0.2.3-spike" };
      },
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      },
      sendMessage(message, callback) {
        if (message?.type === "M0_FULL_SCAN_PROGRESS") {
          globalThis.__m0ProgressEvents.push(message.progress);
          callback?.({ ok: true });
          return;
        }
        Promise.resolve(globalThis.CollectionRevivalFullScanDb.handleMessage(message))
          .then((response) => callback?.(response))
          .catch((error) => callback?.({ ok: false, error: error.message }));
      }
    }
  };
  globalThis.__sendM0MessageToContent = (message) => new Promise((resolve) => {
    if (!listeners.length) {
      resolve({ ok: false, error: "content listener missing" });
      return;
    }
    let settled = false;
    const sendResponse = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    for (const listener of listeners) {
      const keepAlive = listener(message, {}, sendResponse);
      if (keepAlive === true) return;
    }
    if (!settled) resolve({ ok: false, error: "message not handled" });
  });
}

function toMiB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}
