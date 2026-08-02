importScripts("build-profile.js", "full-scan-idb.js", "api-sync/api-sync-core.js", "api-sync/api-sync-idb.js", "api-sync/api-sync-provider.js");

const BUILD_PROFILE = globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__ || {};
const WEB_APP_ORIGINS = Array.isArray(BUILD_PROFILE.webAppOrigins) ? BUILD_PROFILE.webAppOrigins : [];
const WEB_APP_URL_PATTERNS = WEB_APP_ORIGINS.map((origin) => `${origin}/*`);
const EXTENSION_VERSION = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
  void reinjectOpenWebTabs();
});

chrome.runtime.onStartup?.addListener(() => {
  void configureSidePanel();
  void reinjectOpenWebTabs();
});

void configureSidePanel();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isApiSyncMessage(message)) {
    void handleApiSyncMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (!isDatabaseMessage(message)) return false;
  void handleDatabaseMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

const apiProbeRecords = [];

async function handleApiSyncMessage(message, sender) {
  if (message.type === "M0_API_PROBE_START") {
    if (!sender.tab?.id) throw new Error("Open the Xiaohongshu favorites page before detecting APIs.");
    await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, world: "MAIN", files: ["src/api-sync/api-probe-main.js"] });
    return { ok: true, probes: summarizeProbes() };
  }
  if (message.type === "M0_API_PROBE_RECORD") {
    const probe = sanitizeProbe(message.probe);
    if (probe) {
      const existing = apiProbeRecords.findIndex((item) => item.path === probe.path && item.method === probe.method);
      if (existing >= 0) apiProbeRecords[existing] = probe; else apiProbeRecords.push(probe);
    }
    return { ok: true, probes: summarizeProbes() };
  }
  if (message.type === "M0_API_PROBE_GET") return { ok: true, probes: summarizeProbes() };
  if (message.type === "M0_API_SYNC_CREATE_RUN") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.createRun() };
  if (message.type === "M0_API_SYNC_GET_RUN") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.getRun(message.runId) };
  if (message.type === "M0_API_SYNC_DISCARD") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.discardRun(message.runId) };
  if (message.type === "M0_API_SYNC_CONFIRM") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.confirmImport(message.runId) };
  if (message.type === "M0_API_SYNC_READ") {
    const probes = summarizeProbes();
    const kinds = new Set(probes.map((probe) => probe.kind));
    if (!kinds.has("favorites") || !kinds.has("albums") || !kinds.has("memberships")) return { ok: false, error: "API_MAPPING_NOT_CONFIRMED: detect all three read endpoints first." };
    if (probes.some((probe) => probe.needsDynamicSignature)) return { ok: false, error: "DYNAMIC_SIGNATURE_REQUIRED: no safe page-native replay mapping has been confirmed." };
    return { ok: false, error: "PAGE_NATIVE_TRANSPORT_NOT_CONFIRMED: captured metadata is intentionally not used as an authenticated request template." };
  }
  return { ok: false, error: "Unsupported API sync request" };
}

function isApiSyncMessage(message) {
  return ["M0_API_PROBE_START", "M0_API_PROBE_RECORD", "M0_API_PROBE_GET", "M0_API_SYNC_CREATE_RUN", "M0_API_SYNC_GET_RUN", "M0_API_SYNC_READ", "M0_API_SYNC_DISCARD", "M0_API_SYNC_CONFIRM"].includes(message?.type);
}

function sanitizeProbe(value) {
  if (!value || typeof value !== "object" || !/^\/[a-zA-Z0-9_./-]+$/.test(String(value.path || ""))) return null;
  const fields = (items) => Array.isArray(items) ? items.filter((item) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(String(item)) && !/cookie|token|auth|sign|user.?id|account/i.test(item)).slice(0, 30) : [];
  return { path: value.path, method: value.method === "POST" ? "POST" : "GET", requestFields: fields(value.requestFields), responseFields: fields(value.responseFields), cursorType: ["cursor", "page", "pageNum", "lastCursor", "nextCursor", "none"].includes(value.cursorType) ? value.cursorType : "none", hasMoreField: Boolean(value.hasMoreField), count: Math.max(0, Math.min(9999, Number(value.count) || 0)), kind: ["favorites", "albums", "memberships", "unknown"].includes(value.kind) ? value.kind : "unknown", needsDynamicSignature: Boolean(value.needsDynamicSignature), example: { request: fields(value.example?.request), response: fields(value.example?.response) } };
}

function summarizeProbes() { return apiProbeRecords.map((probe) => ({ ...probe, requestFields: [...probe.requestFields], responseFields: [...probe.responseFields], example: { ...probe.example } })); }

async function handleDatabaseMessage(message, sender) {
  if (message.type === "M0_PREVIEW_PREPARE_IMPORT") {
    assertM0PreviewProfile();
    const origin = exactPreviewOrigin();
    const response = await globalThis.CollectionRevivalFullScanDb.handleMessage({
      ...message,
      origin,
      extensionVersion: EXTENSION_VERSION
    });
    return {
      ...response,
      previewUrl: `${BUILD_PROFILE.defaultWebAppUrl}?importBatchId=${encodeURIComponent(response.importBatch.importBatchId)}`
    };
  }
  if (message.type.startsWith("M0_PREVIEW_")) assertTrustedPreviewSender(sender);
  return globalThis.CollectionRevivalFullScanDb.handleMessage(message);
}

async function configureSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Older Chromium builds may expose the API before supporting this behavior.
  }
}

function isDatabaseMessage(message) {
  return [
    "M0_FULL_SCAN_CREATE_SESSION",
    "M0_FULL_SCAN_GET_SESSION",
    "M0_FULL_SCAN_UPDATE_SESSION",
    "M0_FULL_SCAN_PERSIST_ITEMS",
    "M0_FULL_SCAN_VERIFY_SESSION",
    "M0_FULL_SCAN_GET_DIAGNOSTICS",
    "M0_FULL_SCAN_LIST_ITEMS",
    "M0_FULL_SCAN_INVALIDATE_SESSION",
    "M0_FULL_SCAN_DISCARD_CONTAMINATED_SESSION",
    "M0_FULL_SCAN_RESET_SESSION",
    "M0_PREVIEW_PREPARE_IMPORT",
    "M0_PREVIEW_IMPORT_META_REQUEST",
    "M0_PREVIEW_IMPORT_CHUNK_REQUEST",
    "M0_PREVIEW_IMPORT_RESULT"
  ].includes(message?.type);
}

function assertM0PreviewProfile() {
  if (BUILD_PROFILE.id !== "m0-preview") throw new Error("当前扩展不是 M0 Preview，禁止创建导入批次。");
  exactPreviewOrigin();
}

function exactPreviewOrigin() {
  if (WEB_APP_ORIGINS.length !== 1) throw new Error("M0 Preview 必须且只能配置一个精确导入 origin。");
  const origin = new URL(WEB_APP_ORIGINS[0]).origin;
  if (origin !== WEB_APP_ORIGINS[0] || origin.includes("*")) throw new Error("M0 Preview origin 配置不精确。");
  return origin;
}

function assertTrustedPreviewSender(sender) {
  assertM0PreviewProfile();
  const senderOrigin = sender?.origin || safeOrigin(sender?.url);
  if (senderOrigin !== exactPreviewOrigin()) throw new Error("导入请求不是来自允许的 M0 Preview origin。");
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

async function reinjectOpenWebTabs() {
  if (!WEB_APP_URL_PATTERNS.length) return;
  const tabs = await chrome.tabs.query({ url: WEB_APP_URL_PATTERNS });
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/build-profile.js", "src/web-bridge.js"]
      });
    } catch {
      // A loading or inaccessible tab will receive the manifest content script on its next navigation.
    }
  }));
}
