import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const requiredFiles = [
  "src/sidepanel.html",
  "src/sidepanel.css",
  "src/sidepanel.js",
  "src/full-scan-core.js",
  "src/full-scan-content.js",
  "src/full-scan-idb.js"
];

for (const file of requiredFiles) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    throw new Error(`Missing M0 full scan spike file: ${file}`);
  }
}

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
if (!manifest.permissions.includes("sidePanel")) throw new Error("M0 full scan requires the sidePanel permission");
if (manifest.side_panel?.default_path !== "src/sidepanel.html") throw new Error("Side Panel default path is missing");
if (manifest.action?.default_popup) throw new Error("The extension action must open the Side Panel, not a short-lived popup");
const scannerEntry = (manifest.content_scripts || []).find((entry) => (entry.js || []).includes("src/full-scan-content.js"));
if (!scannerEntry) throw new Error("M0 full scan content adapter is not registered");
assertOrdered(
  scannerEntry.js,
  ["src/full-scan-core.js", "src/xhs-scanner.js", "src/full-scan-content.js"],
  "full scan content scripts"
);

for (const file of [
  "sidepanel.js",
  "full-scan-core.js",
  "full-scan-content.js",
  "full-scan-idb.js",
  "background.js"
]) {
  execFileSync(process.execPath, ["--check", fileURLToPath(new URL(`../src/${file}`, import.meta.url))], {
    stdio: "inherit"
  });
}

const sidepanelHtml = readFileSync(new URL("../src/sidepanel.html", import.meta.url), "utf8");
const sidepanelJs = readFileSync(new URL("../src/sidepanel.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../src/full-scan-core.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../src/full-scan-content.js", import.meta.url), "utf8");
const idb = readFileSync(new URL("../src/full-scan-idb.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
const build = readFileSync(new URL("./build-extension.mjs", import.meta.url), "utf8");

for (const marker of [
  "M0 全量扫描 Preview 0.3.3",
  "扫描全部收藏",
  "暂停",
  "继续",
  "停止并保留进度",
  "重新开始一次扫描",
  "随机 50 条",
  "导出脱敏统计",
  "导入收藏复活",
  "重新检测当前页面"
]) {
  if (!sidepanelHtml.includes(marker) && !sidepanelJs.includes(marker)) {
    throw new Error(`Missing Side Panel capability marker: ${marker}`);
  }
}
for (const marker of [
  "FullScanController",
  "MutationObserver",
  "REQUIRED_STABLE_CYCLES = 5",
  "PERSIST_BATCH_SIZE = 25",
  "FAVORITES_PANEL_NOT_FOUND",
  "EXCLUDED_PANEL_INSIDE_ROOT",
  "scrollFavoritesContainerToBottom",
  "waitForActivityToSettle",
  "confirmTrueEnd",
  "syncPageBindings",
  "END_NOT_PROVEN",
  "fallbackScrollAttempts",
  "rootRebindCount",
  "M0_FULL_SCAN_VERIFY_SESSION"
]) {
  if (!core.includes(marker)) throw new Error(`Missing full scan engine marker: ${marker}`);
}
if (core.includes("root = document.body") || core.includes("element: document.body")) {
  throw new Error("M0 full scan core must never fall back to document.body");
}

for (const field of [
  "sessionId",
  "profileIdHash",
  "favoritesPageIdentity",
  "status",
  "startedAt",
  "updatedAt",
  "discoveredCount",
  "validCount",
  "duplicateCount",
  "invalidCount",
  "lastSourceId",
  "lastScrollTop",
  "lastScrollHeight",
  "stableNoGrowthCycles",
  "retryCount",
  "selectorVersion",
  "extensionVersion",
  "itemsCheckpoint",
  "resumeCount",
  "completedAt"
]) {
  if (!idb.includes(field)) throw new Error(`ScanSession field is not persisted: ${field}`);
}

for (const marker of [
  "scanSessions",
  "favoriteItems",
  "scanSessionItems",
  "M0_FULL_SCAN_PERSIST_ITEMS",
  "duplicateInsertCount",
  "uniqueSourceIdCount",
  "collection-revival-m0-preview-v1",
  "M0_PREVIEW_IMPORT_CHUNK_REQUEST"
]) {
  if (!idb.includes(marker)) throw new Error(`Missing Extension IndexedDB marker: ${marker}`);
}

for (const marker of [
  "M0_FULL_SCAN_GET_PAGE_STATUS",
  "M0_FULL_SCAN_WAIT_PAGE_READY",
  "M0_FULL_SCAN_START",
  "M0_FULL_SCAN_PAUSE",
  "M0_FULL_SCAN_RESUME",
  "M0_FULL_SCAN_STOP",
  "M0_FULL_SCAN_PROGRESS"
]) {
  if (!content.includes(marker) && !sidepanelJs.includes(marker)) {
    throw new Error(`Missing Side Panel/content communication marker: ${marker}`);
  }
}

for (const marker of [
  'importScripts("build-profile.js", "full-scan-idb.js")',
  "setPanelBehavior",
  "openPanelOnActionClick",
  "isDatabaseMessage"
]) {
  if (!background.includes(marker)) throw new Error(`Missing background long-task marker: ${marker}`);
}

for (const file of [
  "sidepanel.html",
  "sidepanel.js",
  "sidepanel.css",
  "full-scan-core.js",
  "full-scan-content.js",
  "full-scan-idb.js"
]) {
  if (!build.includes(`"${file}"`)) throw new Error(`Extension build does not include ${file}`);
}

const coreApi = loadCore();
const sourceId = coreApi.extractSourceId(
  "https://www.xiaohongshu.com/discovery/item/m0fixture000001?xsec_token=masked",
  "https://www.xiaohongshu.com/"
);
if (sourceId !== "m0fixture000001") throw new Error(`sourceId extraction failed: ${sourceId}`);
const canonical = coreApi.canonicalizeSourceUrl(
  "https://www.xiaohongshu.com/discovery/item/m0fixture000001?xsec_token=masked&noise=1",
  "",
  "https://www.xiaohongshu.com/"
);
if (canonical !== "https://www.xiaohongshu.com/explore/m0fixture000001?xsec_token=masked") {
  throw new Error(`canonical URL normalization failed: ${canonical}`);
}

console.log("M0 full scan spike static validation ok");

function loadCore() {
  const context = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(core, context, { filename: "full-scan-core.js" });
  return context.CollectionRevivalFullScanCore;
}

function assertOrdered(values, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const index = values.indexOf(needle);
    if (index === -1) throw new Error(`Missing ${label} marker: ${needle}`);
    if (index <= cursor) throw new Error(`Incorrect ${label} order around ${needle}`);
    cursor = index;
  }
}
