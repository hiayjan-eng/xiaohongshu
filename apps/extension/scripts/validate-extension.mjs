import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const requiredFiles = [
  "manifest.json",
  "src/popup.html",
  "src/popup.js",
  "src/popup.css",
  "src/web-bridge.js",
  "src/xhs-scanner.js",
  "src/background.js"
];

for (const file of requiredFiles) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    throw new Error(`Missing extension file: ${file}`);
  }
}

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (manifest.version !== "0.2.2") throw new Error("Extension version must be 0.2.2");
if (!manifest.permissions.includes("activeTab")) throw new Error("activeTab permission is required for user-triggered scanning");
if (!manifest.permissions.includes("scripting")) throw new Error("scripting permission is required for programmatic content script injection");
if (!manifest.permissions.includes("storage")) throw new Error("storage permission is required for checkpoint restore");
if (!manifest.permissions.includes("downloads")) throw new Error("downloads permission is required for JSON export");

const contentScripts = manifest.content_scripts ?? [];
const contentMatches = contentScripts.flatMap((entry) => entry.matches || []);
if (!contentMatches.includes("https://xiaohongshu-green.vercel.app/*")) throw new Error("Web handshake content script match is required");
if (!contentMatches.includes("http://localhost:5173/*")) throw new Error("Localhost web handshake match is required");
if (!contentMatches.includes("https://www.xiaohongshu.com/*")) throw new Error("Xiaohongshu scanner match is required");
if (!contentMatches.includes("https://xiaohongshu.com/*")) throw new Error("Xiaohongshu root scanner match is required");

const webBridgeEntry = contentScripts.find((entry) => (entry.js || []).includes("src/web-bridge.js"));
const scannerEntry = contentScripts.find((entry) => (entry.js || []).includes("src/xhs-scanner.js"));
if (!webBridgeEntry) throw new Error("Missing Web Bridge content script entry");
if (!scannerEntry) throw new Error("Missing Xiaohongshu scanner content script entry");
if (manifest.background?.service_worker !== "src/background.js") throw new Error("Missing background service worker");

for (const script of ["popup.js", "web-bridge.js", "xhs-scanner.js", "background.js"]) {
  execFileSync(process.execPath, ["--check", fileURLToPath(new URL(`../src/${script}`, import.meta.url))], { stdio: "inherit" });
}

const popupJs = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const popupCss = readFileSync(new URL("../src/popup.css", import.meta.url), "utf8");
const webBridge = readFileSync(new URL("../src/web-bridge.js", import.meta.url), "utf8");
const scanner = readFileSync(new URL("../src/xhs-scanner.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");

const popupMarkers = ["CHECKPOINT_KEY", "SCAN_STATE_KEY", "pauseScan", "resumeScan", "retryScan", "browser-extension-beta", "autoScrollToggle", "clearCheckpoint", "openOrRefreshWebApp", "ensureWebBridgeScript", "bridgeStatus", "scannerStatus", "progressTrack", "filterSelect"];
const bridgeMarkers = ["COLLECTION_REVIVAL_EXTENSION_READY", "COLLECTION_REVIVAL_EXTENSION_PING", "COLLECTION_REVIVAL_EXTENSION_PONG", "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS_REQUEST", "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS", "requestId", "protocolVersion", "collection-revival-web-bridge-v1", "collectionRevivalExtensionVersion", "collection-revival-extension-bridge", "scan-progress-sync"];
const scannerMarkers = ["REVIVAL_GET_PAGE_STATUS", "REVIVAL_START_SCAN", "REVIVAL_PAUSE_SCAN", "REVIVAL_RESUME_SCAN", "REVIVAL_GET_SCAN_STATE", "scrollOneStep", "findCollectionRoot", "isElementVisible", "normalizeScannedText", "blocked", "验证码", "xhs-fav-container-v2"];
const backgroundMarkers = ["onInstalled", "onStartup", "executeScript", "web-bridge.js"];
for (const marker of popupMarkers) {
  if (!popupJs.includes(marker) && !popupHtml.includes(marker)) throw new Error(`Missing popup beta capability marker: ${marker}`);
}
for (const marker of bridgeMarkers) {
  if (!webBridge.includes(marker)) throw new Error(`Missing Web Bridge marker: ${marker}`);
}
for (const marker of scannerMarkers) {
  if (!scanner.includes(marker)) throw new Error(`Missing scanner beta capability marker: ${marker}`);
}
for (const marker of backgroundMarkers) {
  if (!background.includes(marker)) throw new Error(`Missing background recovery marker: ${marker}`);
}

assertPopupStructure();
assertProgressAndListUi();
assertScannerBehavior();

console.log("extension beta manifest and scripts ok");

function assertPopupStructure() {
  assertOrdered(popupHtml, [
    "popup-header",
    "pageHealth",
    "scan-panel",
    "startScan",
    "progress-card",
    "statsGrid",
    "results",
    "sticky-import",
    "more-settings"
  ], "popup first-screen order");

  for (const limitValue of ['value="200"', 'value="500"', 'value="1000"', 'value="all"']) {
    if (!popupHtml.includes(limitValue)) throw new Error(`Missing scan limit option: ${limitValue}`);
  }

  for (const filterValue of ['value="all"', 'value="selected"', 'value="duplicate"', 'value="missing-title"', 'value="own"', 'value="missing-link"']) {
    if (!popupHtml.includes(filterValue)) throw new Error(`Missing result filter option: ${filterValue}`);
  }

  if (!popupHtml.includes("仅在你主动点击后读取当前小红书收藏页中已加载的可见卡片")) {
    throw new Error("Popup safety boundary copy is missing or too verbose");
  }
}

function assertProgressAndListUi() {
  const cssRequirements = [
    "height: 620px",
    "overflow: hidden",
    ".progress-track.indeterminate",
    "transition: width 280ms ease",
    ".sticky-import",
    "position: sticky",
    "overflow-x: hidden",
    "-webkit-line-clamp: 2",
    "@media (prefers-reduced-motion: reduce)"
  ];
  for (const requirement of cssRequirements) {
    if (!popupCss.includes(requirement)) throw new Error(`Missing popup CSS requirement: ${requirement}`);
  }

  const jsRequirements = [
    "scheduleRender",
    "setTimeout(() => {",
    "visibleItems.slice(0, 120)",
    "formatShortUrl",
    "scan.mode === \"all\"",
    "progressTrack.classList.toggle(\"indeterminate\"",
    "REVIVAL_GET_SCAN_STATE",
    "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS_REQUEST"
  ];
  for (const requirement of jsRequirements) {
    if (!popupJs.includes(requirement) && !webBridge.includes(requirement)) {
      throw new Error(`Missing popup/progress behavior marker: ${requirement}`);
    }
  }
}

function assertScannerBehavior() {
  const exports = loadScannerTestExports();
  const cleaned = exports.normalizeScannedText("  标题\u200B \uFEFF😆\n\nCodex&nbsp;教程  ");
  if (cleaned !== "标题 😆 Codex 教程") throw new Error(`normalizeScannedText failed: ${cleaned}`);

  const title = exports.sanitizeTitle("置顶 3个方法，让codex帮你猛猛干活！！ https://www.xiaohongshu.com/explore/abc image", "");
  if (title.includes("http") || title.includes("image") || title.includes("置顶")) throw new Error(`sanitizeTitle kept dirty suffix: ${title}`);
  if (!title.includes("codex")) throw new Error(`sanitizeTitle removed useful title text: ${title}`);

  if (!exports.isLikelyXhsNoteUrl("https://www.xiaohongshu.com/discovery/item/6a15293600000000080251c2?source=webshare")) {
    throw new Error("Xiaohongshu discovery item URL should be recognized");
  }
  if (!exports.isLikelyXhsNoteUrl("https://www.xiaohongshu.com/explore/test-note")) {
    throw new Error("Xiaohongshu explore URL should be recognized");
  }
  if (exports.isLikelyXhsNoteUrl("https://example.com/explore/test-note")) {
    throw new Error("Non-Xiaohongshu URL should not be recognized");
  }

  const milestones = exports.updateMilestones([], 1000);
  for (const expected of ["已找回 100 条旧收藏", "已找回 300 条旧收藏", "已找回 500 条旧收藏", "已找回 1000 条旧收藏"]) {
    if (!milestones.includes(expected)) throw new Error(`Missing progress milestone: ${expected}`);
  }

  const trimmed = exports.trimToLimit([
    { title: "1", sourceUrl: "https://www.xiaohongshu.com/explore/1" },
    { title: "2", sourceUrl: "https://www.xiaohongshu.com/explore/2" },
    { title: "重复", isDuplicate: true, sourceUrl: "https://www.xiaohongshu.com/explore/2" },
    { title: "3", sourceUrl: "https://www.xiaohongshu.com/explore/3" }
  ], 2);
  const accepted = trimmed.filter((item) => !item.isDuplicate).length;
  if (accepted !== 2) throw new Error(`trimToLimit should keep only 2 accepted items, got ${accepted}`);

  const scannerRequirements = [
    "findCollectionRoot",
    "findActiveCollectionTabElement",
    "root.querySelectorAll(\"a[href]\")",
    "root.contains(match)",
    "element.closest(\"[aria-hidden='true'], [hidden]\")",
    "style.display === \"none\"",
    "style.visibility === \"hidden\"",
    "isLikelyOwnPost",
    "containerType",
    "activeTab",
    "selectorVersion"
  ];
  for (const requirement of scannerRequirements) {
    if (!scanner.includes(requirement)) throw new Error(`Missing scanner range/text requirement: ${requirement}`);
  }
}

function loadScannerTestExports() {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    window: undefined,
    location: { href: "https://www.xiaohongshu.com/user/profile/test?tab=fav", hostname: "www.xiaohongshu.com" },
    navigator: { userAgent: "Chrome" },
    chrome: {
      runtime: {
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          async get() { return {}; },
          async set() {},
          async remove() {}
        }
      }
    },
    document: {
      body: { innerText: "" },
      documentElement: { scrollHeight: 2000 },
      createElement(tag) {
        if (tag !== "textarea") return {};
        return {
          _html: "",
          set innerHTML(value) {
            this._html = String(value)
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"');
          },
          get value() {
            return this._html;
          }
        };
      },
      querySelectorAll() {
        return [];
      }
    }
  };
  context.window = {
    __collectionRevivalScannerInstalled: false,
    location: context.location,
    scrollY: 0,
    innerHeight: 900,
    scrollBy() {},
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    }
  };

  const instrumented = scanner.replace(/\}\)\(\);\s*$/, `
    globalThis.__scannerTestExports = {
      normalizeScannedText,
      sanitizeTitle,
      isLikelyXhsNoteUrl,
      updateMilestones,
      trimToLimit
    };
  })();
  `);
  vm.runInNewContext(instrumented, context, { filename: "xhs-scanner.js" });
  return context.__scannerTestExports;
}

function assertOrdered(source, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle);
    if (index === -1) throw new Error(`Missing ${label} marker: ${needle}`);
    if (index <= cursor) throw new Error(`Incorrect ${label}; ${needle} appears out of order`);
    cursor = index;
  }
}
