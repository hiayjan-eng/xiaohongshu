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
  "src/background.js",
  "src/build-profile.js"
];

for (const file of requiredFiles) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    throw new Error(`Missing extension file: ${file}`);
  }
}

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (manifest.version !== "0.2.3") throw new Error("Extension version must be 0.2.3");
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
const scannerMarkers = ["REVIVAL_GET_PAGE_STATUS", "REVIVAL_START_SCAN", "REVIVAL_PAUSE_SCAN", "REVIVAL_RESUME_SCAN", "REVIVAL_GET_SCAN_STATE", "scrollOneStep", "findCollectionRoot", "isElementVisible", "normalizeScannedText", "blocked", "验证码", "xhs-fav-visible-cards-v5"];
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

  for (const limitValue of ['value="10"', 'value="20"', 'value="50"', 'value="100"', 'value="200"']) {
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

async function assertScannerBehavior() {
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

  const milestones = exports.updateMilestones([], 200);
  for (const expected of ["已找回 10 条旧收藏", "已找回 20 条旧收藏", "已找回 50 条旧收藏", "已找回 100 条旧收藏", "已找回 200 条旧收藏"]) {
    if (!milestones.includes(expected)) throw new Error(`Missing progress milestone: ${expected}`);
  }

  for (const target of [10, 20, 50, 100, 200]) {
    if (exports.normalizeScanTarget(target) !== target) throw new Error("Unsupported scan target: " + target);
  }
  if (exports.normalizeScanTarget(999) !== 20) throw new Error("Unknown scan target should safely fall back to 20");

  const noteUrl = "https://www.xiaohongshu.com/discovery/item/6a15293600000000080251c2?xsec_token=masked&xsec_source=pc_collect";
  if (exports.extractSourceId(noteUrl) !== "6a15293600000000080251c2") throw new Error("sourceId extraction failed");
  if (!exports.canonicalizeXhsUrl(noteUrl).includes("/explore/6a15293600000000080251c2")) throw new Error("canonical URL failed");
  if (exports.extractSourceId("https://www.xiaohongshu.com/user/profile/6a15293600000000080251c2")) throw new Error("profile ID must not be treated as sourceId");
  const firstKey = exports.itemKey({ sourceId: "same-note", sourceUrl: "https://www.xiaohongshu.com/explore/same-note?xsec_token=a" });
  const secondKey = exports.itemKey({ sourceId: "same-note", sourceUrl: "https://www.xiaohongshu.com/explore/same-note?xsec_token=b" });
  if (firstKey !== secondKey) throw new Error("query token should not change stable dedupe key");

  const emptyState = exports.createEmptyState();
  for (const field of ["targetCount", "discoveredCount", "validCount", "duplicateCount", "invalidCount", "currentStage", "lastVisibleCardKey", "scrollPosition", "paused", "completed"]) {
    if (!(field in emptyState)) throw new Error("Checkpoint field missing: " + field);
  }

  await assertCheckpointRecovery();

  const trimmed = exports.trimToLimit([
    { title: "1", sourceUrl: "https://www.xiaohongshu.com/explore/1" },
    { title: "2", sourceUrl: "https://www.xiaohongshu.com/explore/2" },
    { title: "重复", isDuplicate: true, sourceUrl: "https://www.xiaohongshu.com/explore/2" },
    { title: "3", sourceUrl: "https://www.xiaohongshu.com/explore/3" }
  ], 2);
  const accepted = trimmed.filter((item) => !item.isDuplicate).length;
  if (accepted !== 2) throw new Error(`trimToLimit should keep only 2 accepted items, got ${accepted}`);

  assertScannerRangeWithMockDom();
  assertRealCollectionDomFixture();

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
    "selectorVersion",
    "scoreCollectionCandidate",
    "collectionPageConfirmed",
    "EXTRACTION_EMPTY",
    "document-body-fallback",
    "extractCardFromContainer"
  ];
  for (const requirement of scannerRequirements) {
    if (!scanner.includes(requirement)) throw new Error(`Missing scanner range/text requirement: ${requirement}`);
  }
}

function assertRealCollectionDomFixture() {
  const fixture = createRealCollectionFixture();
  const exports = loadScannerTestExports(fixture, "https://www.xiaohongshu.com/user/profile/fixture?subTab=note&tab=fav");
  const status = exports.getPageStatus();
  if (!status.collectionPageConfirmed || !status.favoriteRouteSignal || status.extractionState !== "EXTRACTION_READY") {
    throw new Error("Real collection URL fixture should confirm the favorites page before extraction.");
  }
  const result = exports.scanVisibleXhsCards();
  if (result.items.length === 0) throw new Error("Real collection fixture should extract visible cards through fallback candidates.");
  if (!result.items.every((item) => item.sourceUrl.includes("/explore/") || item.sourceUrl.includes("/discovery/item/"))) {
    throw new Error("Real collection fixture should not turn profile links into note links.");
  }
  if (!result.items.some((item) => item.sourceUrl.includes("fixture-data-note"))) {
    throw new Error("data-note-id fallback should produce a note source URL.");
  }
}

function createRealCollectionFixture() {
  const activeFavoriteTab = new FakeElement("button", { className: "tab active", text: "收藏", attrs: { role: "tab", "aria-selected": "true" } });
  const wrongRoot = new FakeElement("section", { className: "profile-header" }, [activeFavoriteTab]);
  const image = new FakeElement("img", { attrs: { src: "https://img.example/fixture.jpg", alt: "脱敏卡片" }, rect: { width: 160, height: 200 } });
  const nestedLink = new FakeElement("a", { href: "/discovery/item/fixture-anchor-note?xsec_token=masked", attrs: { href: "/discovery/item/fixture-anchor-note?xsec_token=masked" }, rect: { width: 180, height: 240 } }, [image, new FakeElement("span", { className: "title", text: "脱敏嵌套卡片" })]);
  const anchorCard = new FakeElement("article", { className: "waterfall-card", rect: { width: 190, height: 260 } }, [nestedLink]);
  const dataCard = new FakeElement("article", { className: "waterfall-card", attrs: { "data-note-id": "fixture-data-note-01" }, text: "脱敏 data note 卡片", rect: { width: 190, height: 260 } }, [new FakeElement("img", { attrs: { src: "https://img.example/data.jpg" }, rect: { width: 160, height: 200 } })]);
  const profileLink = new FakeElement("a", { href: "/user/profile/other", attrs: { href: "/user/profile/other" }, text: "作者页", rect: { width: 120, height: 30 } });
  const cards = new FakeElement("section", { className: "feeds waterfall" }, [anchorCard, dataCard, profileLink]);
  return createFakeDocument(new FakeElement("body", { text: "收藏" }, [wrongRoot, cards]));
}
function assertScannerRangeWithMockDom() {
  const mockDocument = createScannerMockDocument();
  const exports = loadScannerTestExports(mockDocument);
  const rootInfo = exports.findCollectionRoot();
  if (!rootInfo?.element?.className?.includes("collection")) {
    throw new Error(`Scanner should prefer the active collection container, got ${rootInfo?.containerType || "none"}`);
  }

  const result = exports.scanVisibleXhsCards();
  const titles = result.items.map((item) => item.title);
  if (!titles.includes("收藏里的路线 😆")) throw new Error("Visible favorite card should be scanned");
  if (!titles.includes("我自己也收藏的灵感")) throw new Error("Own authored but favorited card should not be removed");
  if (titles.includes("我发布但没收藏")) throw new Error("Hidden published note should not enter scan results");
  if (titles.includes("主页可见发布笔记")) throw new Error("Visible non-favorite profile note should not enter scan results");
  if (result.pageStatus?.diagnostics?.validFavoriteCount !== result.items.length) throw new Error("Scanner diagnostics should expose valid favorite counts");
  const ownFavorite = result.items.find((item) => item.title === "我自己也收藏的灵感");
  if (!ownFavorite?.isLikelyOwnPost) throw new Error("Own authored favorite should be marked, not deleted");
  if (result.items.some((item) => item.isVisible !== true || item.selectorVersion !== "xhs-fav-visible-cards-v5")) {
    throw new Error("Scanned items should include visibility and selector diagnostics");
  }
}

function loadScannerTestExports(documentOverride = createBasicScannerDocument(), href = "https://www.xiaohongshu.com/user/profile/test?tab=fav", storedState = {}) {
  let messageListener;
  const storageData = { ...storedState };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    window: undefined,
    location: { href, hostname: "www.xiaohongshu.com" },
    navigator: { userAgent: "Chrome" },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { messageListener = listener; } }
      },
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter((key) => key in storageData).map((key) => [key, storageData[key]]));
          },
          async set(values) { Object.assign(storageData, values); },
          async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storageData[key]); }
        }
      }
    },
    document: documentOverride
  };
  context.window = {
    __collectionRevivalScannerInstalled: false,
    location: context.location,
    scrollY: 0,
    innerHeight: 900,
    scrollBy() {},
    scrollTo({ top }) { this.scrollY = top; },
    getComputedStyle(element) {
      const hidden = !isFakeElementVisible(element);
      return { display: hidden ? "none" : "block", visibility: hidden ? "hidden" : "visible", opacity: hidden ? "0" : "1" };
    }
  };
  context.document.defaultView = context.window;

  const instrumented = scanner.replace(/\}\)\(\);\s*$/, `
    globalThis.__scannerTestExports = {
      normalizeScannedText,
      sanitizeTitle,
      isLikelyXhsNoteUrl,
      updateMilestones,
      trimToLimit,
      findCollectionRoot,
      scanVisibleXhsCards,
      getPageStatus,
      normalizeScanTarget,
      extractSourceId,
      canonicalizeXhsUrl,
      itemKey,
      createEmptyState
    };
  })();
  `);
  vm.runInNewContext(instrumented, context, { filename: "xhs-scanner.js" });
  context.__scannerTestExports.__messageListener = messageListener;
  context.__scannerTestExports.__storageData = storageData;
  return context.__scannerTestExports;
}

async function assertCheckpointRecovery() {
  const stored = {
    "revival-extension-scan-state": {
      status: "paused",
      stage: "loading",
      targetCount: 100,
      limit: 100,
      discoveredCount: 1,
      validCount: 1,
      duplicateCount: 0,
      invalidCount: 0,
      currentStage: "loading",
      lastVisibleCardKey: "source:phase2-recovery-note",
      scrollPosition: 480,
      paused: true,
      completed: false,
      items: [{ sourceId: "phase2-recovery-note", sourceUrl: "https://www.xiaohongshu.com/explore/phase2-recovery-note", scanKey: "source:phase2-recovery-note" }],
      selectedKeys: ["source:phase2-recovery-note"]
    }
  };
  const exports = loadScannerTestExports(createBasicScannerDocument(), "https://www.xiaohongshu.com/user/profile/test?tab=fav", stored);
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("checkpoint recovery timed out")), 1000);
    exports.__messageListener({ type: "REVIVAL_GET_SCAN_STATE" }, {}, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
  if (!response.ok || response.scanState.targetCount !== 100 || response.scanState.discoveredCount !== 1 || !response.scanState.paused) {
    throw new Error("Extension reload should restore the latest scan checkpoint");
  }
  if (response.scanState.items[0]?.sourceId !== "phase2-recovery-note") throw new Error("Checkpoint recovery lost stable sourceId");
}

function createBasicScannerDocument() {
  const body = new FakeElement("body", { text: "" });
  return createFakeDocument(body);
}

function createScannerMockDocument() {
  const profileName = new FakeElement("div", { className: "user-name", text: "我自己" });
  const activeFavoriteTab = new FakeElement("span", { className: "active selected", text: "收藏", attrs: { "aria-selected": "true" } });
  const noteTab = new FakeElement("span", { text: "笔记", attrs: { "aria-selected": "false" } });
  const tabs = new FakeElement("div", { className: "tabs" }, [noteTab, activeFavoriteTab]);

  const favoriteList = new FakeElement("section", { className: "collection fav-note-list feeds" }, [
    createNoteCard({ title: "收藏里的路线 😆", author: "路人", href: "https://www.xiaohongshu.com/explore/fav-route" }),
    createNoteCard({ title: "我自己也收藏的灵感", author: "我自己", href: "https://www.xiaohongshu.com/explore/own-favorited" })
  ]);

  const hiddenPublishedList = new FakeElement("section", { className: "publish-note-list feeds", visible: false }, [
    createNoteCard({ title: "我发布但没收藏", author: "我自己", href: "https://www.xiaohongshu.com/explore/hidden-published" })
  ]);

  const visiblePublishedList = new FakeElement("section", { className: "publish-note-list feeds" }, [
    createNoteCard({ title: "主页可见发布笔记", author: "我自己", href: "https://www.xiaohongshu.com/explore/visible-published" })
  ]);

  const main = new FakeElement("main", { className: "user-page" }, [tabs, favoriteList, hiddenPublishedList, visiblePublishedList]);
  const body = new FakeElement("body", { text: "我的 收藏 笔记" }, [profileName, main]);
  return createFakeDocument(body);
}

function createNoteCard({ title, author, href }) {
  const titleElement = new FakeElement("div", { className: "title", text: title });
  const authorElement = new FakeElement("div", { className: "author", text: author });
  const image = new FakeElement("img", { attrs: { src: `https://img.example/${encodeURIComponent(title)}.jpg`, alt: title }, rect: { width: 160, height: 200 } });
  const anchor = new FakeElement("a", { attrs: { href }, href, text: "", rect: { width: 180, height: 240 } }, [image, titleElement, authorElement]);
  return new FakeElement("article", { className: "note-card", rect: { width: 180, height: 260 } }, [anchor]);
}

function createFakeDocument(body) {
  return {
    body,
    documentElement: { scrollHeight: 2000 },
    createElement(tag) {
      if (tag !== "textarea") return new FakeElement(tag);
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
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    }
  };
}

class FakeElement {
  constructor(tagName, options = {}, children = []) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id || "";
    this.className = options.className || "";
    this.attrs = options.attrs || {};
    this.href = options.href || this.attrs.href || "";
    this.ownText = options.text || "";
    this.visible = options.visible !== false;
    this.rect = options.rect || { width: 240, height: 120 };
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  get textContent() {
    return [this.ownText, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
  }

  get innerText() {
    return this.textContent;
  }

  get innerHTML() {
    return this.textContent;
  }

  getAttribute(name) {
    if (name === "class") return this.className;
    if (name === "id") return this.id;
    if (name === "href") return this.href;
    return this.attrs[name] ?? null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const descendants = [];
    walkFakeTree(this, (node) => {
      if (node !== this && selectors.some((part) => matchesFakeSelector(node, part))) descendants.push(node);
    });
    return descendants;
  }

  closest(selector) {
    const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
    let node = this;
    while (node) {
      if (selectors.some((part) => matchesFakeSelector(node, part))) return node;
      node = node.parentElement;
    }
    return null;
  }

  contains(other) {
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }

  getBoundingClientRect() {
    if (!isFakeElementVisible(this)) return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    return { ...this.rect, top: 0, left: 0, right: this.rect.width, bottom: this.rect.height };
  }
}

function walkFakeTree(root, visit) {
  visit(root);
  root.children.forEach((child) => walkFakeTree(child, visit));
}

function isFakeElementVisible(element) {
  let node = element;
  while (node) {
    if (!node.visible || node.attrs.hidden || node.attrs["aria-hidden"] === "true") return false;
    node = node.parentElement;
  }
  return true;
}

function matchesFakeSelector(element, selector) {
  if (!selector) return false;
  if (selector === "[role='tab'][aria-selected='true']") return element.getAttribute("role") === "tab" && element.getAttribute("aria-selected") === "true";
  if (selector === "*") return true;
  if (/^[a-z]+$/i.test(selector)) return element.tagName.toLowerCase() === selector.toLowerCase();
  if (selector === "a[href]") return element.tagName === "A" && Boolean(element.href);
  if (selector === "img[src]" || selector === "img[data-src]" || selector === "picture img") return element.tagName === "IMG";
  if (selector === "a[href*='/user/profile']") return element.tagName === "A" && String(element.href).includes("/user/profile");
  if (selector.startsWith(".")) return classList(element).includes(selector.slice(1));
  const classContains = selector.match(/^\[class\*=['"]([^'"]+)['"]\]$/);
  if (classContains) return String(element.className).includes(classContains[1]);
  const attrEquals = selector.match(/^\[([^=\]]+)=['"]([^'"]+)['"]\]$/);
  if (attrEquals) return String(element.getAttribute(attrEquals[1]) || "") === attrEquals[2];
  const attrOnly = selector.match(/^\[([^\]]+)\]$/);
  if (attrOnly) return element.getAttribute(attrOnly[1]) != null;
  if (selector === "[class*='user-page'] main") return element.tagName === "MAIN" && hasAncestorClassContaining(element, "user-page");
  return false;
}

function classList(element) {
  return String(element.className || "").split(/\s+/).filter(Boolean);
}

function hasAncestorClassContaining(element, value) {
  let node = element.parentElement;
  while (node) {
    if (String(node.className || "").includes(value)) return true;
    node = node.parentElement;
  }
  return false;
}

assertPopupStructure();
assertProgressAndListUi();
await assertScannerBehavior();

console.log("extension beta manifest and scripts ok");

function assertOrdered(source, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle);
    if (index === -1) throw new Error(`Missing ${label} marker: ${needle}`);
    if (index <= cursor) throw new Error(`Incorrect ${label}; ${needle} appears out of order`);
    cursor = index;
  }
}
