import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const playwrightModule = pathToFileURL(resolve(repoRoot, "apps", "web", "node_modules", "@playwright", "test", "index.mjs")).href;
const { chromium } = await import(playwrightModule);
const fixtureHtml = await readFile(resolve(extensionRoot, "tests", "fixtures", "full-scan-premature-completion.html"), "utf8");
const scriptPaths = [
  resolve(extensionRoot, "src", "full-scan-idb.js"),
  resolve(extensionRoot, "src", "full-scan-core.js"),
  resolve(extensionRoot, "src", "full-scan-content.js")
];
const allScenarios = [
  { mode: "delayed-190", seedExisting: true },
  { mode: "plateau" },
  { mode: "root-replaced" },
  { mode: "inner-window" },
  { mode: "true-end" },
  { mode: "unproven-end", expectIncomplete: true }
];
const requestedMode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice("--mode=".length) || "";
const scenarios = requestedMode ? allScenarios.filter((scenario) => scenario.mode === requestedMode) : allScenarios;
if (!scenarios.length) throw new Error(`Unknown premature completion fixture mode: ${requestedMode}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
try {
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario));
  console.log(JSON.stringify({ status: "PASS", total: 3000, scenarios: results }, null, 2));
} finally {
  await browser.close();
}

async function runScenario(scenario) {
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
  try {
    await page.goto(
      `https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&fixtureMode=${scenario.mode}`,
      { waitUntil: "domcontentloaded" }
    );
    await installExtensionScripts(page);

    const pageStatus = await sendToContent(page, { type: "M0_FULL_SCAN_GET_PAGE_STATUS" });
    assert.equal(pageStatus.inspection.ok, true, `${scenario.mode}: page identity must pass`);
    let seedSessionId = "";
    if (scenario.seedExisting) {
      const seed = await sendToContent(page, { type: "M0_FULL_SCAN_START", debugPauseAfter: 190 });
      assert.equal(seed.ok, true);
      seedSessionId = seed.session.sessionId;
      const paused = await waitForTerminalSession(page, seedSessionId, 15_000);
      assert.equal(paused.status, "paused");
      assert.equal(paused.validCount, 190);
    }

    const started = await sendToContent(page, { type: "M0_FULL_SCAN_START" });
    assert.equal(started.ok, true);
    assert.notEqual(started.session.sessionId, seedSessionId || "missing");
    if (scenario.expectIncomplete) {
      const incomplete = await waitForTerminalSession(page, started.session.sessionId, 15_000);
      const runtime = await sendToContent(page, { type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS" });
      const fixture = await page.evaluate(() => ({
        loaded: globalThis.__M0_PREMATURE_FIXTURE__.loaded,
        loading: globalThis.__M0_PREMATURE_FIXTURE__.loading
      }));
      assert.equal(incomplete.status, "needs_user");
      assert.equal(incomplete.lastErrorCode, "END_NOT_PROVEN");
      assert.equal(incomplete.validCount, 190);
      assert.equal(fixture.loaded, 190);
      assert.equal(fixture.loading, true);
      assert.ok(runtime.diagnostics.endConfirmationAttempts > 0);
      assert.equal(runtime.diagnostics.lastEndProof, "");
      return {
        mode: scenario.mode,
        finalCount: incomplete.validCount,
        terminalStatus: incomplete.status,
        endProof: "",
        prematureCompletionObserved: false
      };
    }
    const completion = await waitForTrueCompletion(page, started.session.sessionId, 45_000);
    const runtime = await sendToContent(page, { type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS" });
    const fixture = await page.evaluate(() => ({
      loaded: globalThis.__M0_PREMATURE_FIXTURE__.loaded,
      total: globalThis.__M0_PREMATURE_FIXTURE__.total,
      loadRequests: globalThis.__M0_PREMATURE_FIXTURE__.loadRequests,
      rootReplacementCount: globalThis.__M0_PREMATURE_FIXTURE__.rootReplacementCount,
      completedMarkerShownAt: globalThis.__M0_PREMATURE_FIXTURE__.completedMarkerShownAt,
      rootConnected: globalThis.__M0_PREMATURE_FIXTURE__.rootConnected
    }));

    assert.equal(completion.status, "completed");
    assert.equal(completion.validCount, 3000);
    assert.equal(fixture.loaded, 3000);
    assert.ok(fixture.completedMarkerShownAt > 0, `${scenario.mode}: true end marker must be rendered before completion`);
    assert.equal(runtime.diagnostics.rootConnected, true);
    assert.ok(runtime.diagnostics.observerAddedNodeCount > 0, `${scenario.mode}: observer must receive later batches`);
    assert.ok(runtime.diagnostics.endConfirmationAttempts > 0);
    assert.ok(runtime.diagnostics.lastEndProof);
    assert.ok(runtime.diagnostics.scrollGeometry.clientHeight > 0);
    assert.ok(runtime.diagnostics.scrollGeometry.scrollHeight >= runtime.diagnostics.scrollGeometry.clientHeight);
    if (scenario.mode === "root-replaced") {
      assert.equal(fixture.rootReplacementCount, 1);
      assert.ok(runtime.diagnostics.rootRebindCount >= 1);
    }
    if (scenario.mode === "inner-window") assert.ok(runtime.diagnostics.fallbackScrollAttempts > 0);
    if (scenario.seedExisting) {
      assert.equal(completion.existingCount, 190);
      assert.equal(completion.newItemCount, 2810);
      assert.equal(completion.duplicateInsertCount, 0);
    }

    return {
      mode: scenario.mode,
      finalCount: completion.validCount,
      existingCount: completion.existingCount,
      newItemCount: completion.newItemCount,
      rootRebindCount: runtime.diagnostics.rootRebindCount,
      fallbackScrollAttempts: runtime.diagnostics.fallbackScrollAttempts,
      observerAddedNodeCount: runtime.diagnostics.observerAddedNodeCount,
      endProof: runtime.diagnostics.lastEndProof,
      prematureCompletionObserved: false
    };
  } finally {
    await context.close();
  }
}

async function installExtensionScripts(page) {
  for (const path of scriptPaths) await page.addScriptTag({ path });
}

async function sendToContent(page, message) {
  return page.evaluate((payload) => globalThis.__sendM0MessageToContent(payload), message);
}

async function getSession(page, sessionId) {
  return page.evaluate((id) => globalThis.CollectionRevivalFullScanDb.getSession(id), sessionId);
}

async function waitForTerminalSession(page, sessionId, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const session = await getSession(page, sessionId);
    if (["completed", "paused", "needs_user", "stopped"].includes(session?.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for terminal session: ${sessionId}`);
}

async function waitForTrueCompletion(page, sessionId, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const [session, fixture] = await Promise.all([
      getSession(page, sessionId),
      page.evaluate(() => ({ loaded: globalThis.__M0_PREMATURE_FIXTURE__.loaded, total: globalThis.__M0_PREMATURE_FIXTURE__.total }))
    ]);
    if (session?.status === "completed") {
      assert.equal(fixture.loaded, fixture.total, `session completed prematurely at ${fixture.loaded}/${fixture.total}`);
      return session;
    }
    if (["paused", "needs_user", "stopped"].includes(session?.status)) {
      throw new Error(`Expected completed, got ${session.status}: ${session.lastErrorCode || "no code"} ${session.lastErrorMessage || ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const [session, runtime, fixture] = await Promise.all([
    getSession(page, sessionId),
    sendToContent(page, { type: "M0_FULL_SCAN_GET_RUNTIME_DIAGNOSTICS" }),
    page.evaluate(() => ({ loaded: globalThis.__M0_PREMATURE_FIXTURE__.loaded, loadRequests: globalThis.__M0_PREMATURE_FIXTURE__.loadRequests }))
  ]);
  throw new Error(`Timed out waiting for true completion: ${JSON.stringify({ session, runtime, fixture })}`);
}

function installChromeFixtureBridge() {
  globalThis.__M0_FULL_SCAN_TEST_MODE__ = true;
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.3.3", version_name: "0.3.3-m0-preview" }),
      onMessage: { addListener(listener) { listeners.push(listener); } },
      sendMessage(message, callback) {
        if (message?.type === "M0_FULL_SCAN_PROGRESS") return void callback?.({ ok: true });
        Promise.resolve(globalThis.CollectionRevivalFullScanDb.handleMessage(message))
          .then((response) => callback?.(response))
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
      if (listener(message, {}, sendResponse) === true) return;
    }
    if (!settled) resolve({ ok: false, error: "message not handled" });
  });
}
