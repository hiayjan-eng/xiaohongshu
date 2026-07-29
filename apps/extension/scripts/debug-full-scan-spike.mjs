import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, "..");
const repoRoot = resolve(extensionRoot, "..", "..");
const { chromium } = await import(pathToFileURL(resolve(repoRoot, "apps", "web", "node_modules", "@playwright", "test", "index.mjs")).href);
const html = await readFile(resolve(extensionRoot, "tests", "fixtures", "full-scan-virtual-list.html"), "utf8");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext();
await context.addInitScript(() => {
  globalThis.__M0_FULL_SCAN_TEST_MODE__ = true;
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.2.3-spike" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage(message, callback) {
        if (message?.type === "M0_FULL_SCAN_PROGRESS") return;
        Promise.resolve(globalThis.CollectionRevivalFullScanDb.handleMessage(message))
          .then((response) => callback?.(response))
          .catch((error) => callback?.({ ok: false, error: error.message }));
      }
    }
  };
  globalThis.__send = (message) => new Promise((resolve) => {
    for (const listener of listeners) {
      if (listener(message, {}, resolve) === true) return;
    }
    resolve({ ok: false, error: "unhandled" });
  });
});
const page = await context.newPage();
await page.route("https://www.xiaohongshu.com/**", (route) => route.request().resourceType() === "document"
  ? route.fulfill({ status: 200, contentType: "text/html", body: html })
  : route.abort());
await page.goto("https://www.xiaohongshu.com/user/profile/m0fixtureprofile?tab=fav&subTab=note&total=3000");
for (const file of ["full-scan-idb.js", "full-scan-core.js", "full-scan-content.js"]) {
  await page.addScriptTag({ path: resolve(extensionRoot, "src", file) });
}
await page.evaluate(() => globalThis.CollectionRevivalFullScanDb.clearDatabaseForTests());
const started = await page.evaluate(() => globalThis.__send({ type: "M0_FULL_SCAN_START", debugPauseAfter: 1200 }));
await page.waitForFunction(async (sessionId) => {
  const session = await globalThis.CollectionRevivalFullScanDb.getSession(sessionId);
  return ["paused", "completed"].includes(session?.status);
}, started.session.sessionId, { timeout: 20000 });
const result = await page.evaluate(async (sessionId) => ({
  session: await globalThis.CollectionRevivalFullScanDb.getSession(sessionId),
  fixture: {
    loaded: globalThis.__M0_FULL_SCAN_FIXTURE__.loaded,
    loadRequests: globalThis.__M0_FULL_SCAN_FIXTURE__.loadRequests
  },
  progress: globalThis.__m0ProgressEvents
}), started.session.sessionId);
console.log(JSON.stringify(result, null, 2));
await browser.close();
