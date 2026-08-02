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
const apiProbeBridgeTabs = new Set();
const apiProbeMainTabs = new Set();
let apiProbeSession = null;

async function handleApiSyncMessage(message, sender) {
  if (message.type === "M0_API_PROBE_START") {
    const targetTabId = Number(message.targetTabId);
    if (!Number.isInteger(targetTabId) || targetTabId <= 0) throw new Error("Target Xiaohongshu tab is required.");
    const tab = await chrome.tabs.get(targetTabId);
    const url = new URL(tab.url || "");
    if (url.protocol !== "https:" || !["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname)) throw new Error("当前标签页不是小红书页面，无法开始检测。");
    apiProbeRecords.length = 0;
    apiProbeBridgeTabs.delete(targetTabId);
    apiProbeMainTabs.delete(targetTabId);
    apiProbeSession = createProbeSession(targetTabId);
    return { ok: true, probes: [], session: summarizeProbeSession() };
  }
  if (message.type === "M0_API_PROBE_BRIDGE_READY") {
    if (sender.tab?.id) apiProbeBridgeTabs.add(sender.tab.id);
    updateProbeHandshake(sender.tab?.id, "bridgeReady");
    return { ok: true, session: summarizeProbeSession() };
  }
  if (message.type === "M0_API_PROBE_MAIN_READY") {
    if (sender.tab?.id) apiProbeMainTabs.add(sender.tab.id);
    updateProbeHandshake(sender.tab?.id, "mainReady");
    return { ok: true, session: summarizeProbeSession() };
  }
  if (message.type === "M0_API_PROBE_RECORD") {
    if (!isActiveProbeSender(sender)) return { ok: true, ignored: true, session: summarizeProbeSession() };
    const probe = sanitizeProbe(message.probe);
    if (probe) {
      const existing = apiProbeRecords.findIndex((item) => item.path === probe.path && item.method === probe.method && item.kind === probe.kind);
      if (existing >= 0) apiProbeRecords[existing] = mergeProbe(apiProbeRecords[existing], probe); else apiProbeRecords.push(probe);
      chrome.runtime.sendMessage({ type: "M0_API_PROBE_UPDATED" }).catch(() => {});
    }
    if (apiProbeSession) { apiProbeSession.capturedCount += 1; apiProbeSession.phase = "capturing"; apiProbeSession.updatedAt = new Date().toISOString(); }
    return { ok: true, probes: summarizeProbes(), session: summarizeProbeSession() };
  }
  if (message.type === "M0_API_PROBE_GET") return { ok: true, probes: summarizeProbes(), session: summarizeProbeSession() };
  if (message.type === "M0_API_SYNC_CREATE_RUN") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.createRun() };
  if (message.type === "M0_API_SYNC_GET_RUN") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.getRun(message.runId) };
  if (message.type === "M0_API_SYNC_DISCARD") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.discardRun(message.runId) };
  if (message.type === "M0_API_SYNC_CONFIRM") return { ok: true, run: await globalThis.CollectionRevivalApiSyncDb.confirmImport(message.runId) };
  if (message.type === "M0_API_SYNC_READ") {
    const probes = summarizeProbes();
    const kinds = new Set(probes.map((probe) => probe.kind));
    if (!kinds.has("favorites") || !kinds.has("albums") || !kinds.has("albumContent")) return { ok: false, error: "API_MAPPING_NOT_CONFIRMED: detect favorites, album list, and album content endpoints first." };
    if (probes.some((probe) => probe.needsDynamicSignature)) return { ok: false, error: "DYNAMIC_SIGNATURE_REQUIRED: no safe page-native replay mapping has been confirmed." };
    return { ok: false, error: "PAGE_NATIVE_TRANSPORT_NOT_CONFIRMED: captured metadata is intentionally not used as an authenticated request template." };
  }
  return { ok: false, error: "Unsupported API sync request" };
}

function isApiSyncMessage(message) {
  return ["M0_API_PROBE_START", "M0_API_PROBE_BRIDGE_READY", "M0_API_PROBE_MAIN_READY", "M0_API_PROBE_RECORD", "M0_API_PROBE_GET", "M0_API_SYNC_CREATE_RUN", "M0_API_SYNC_GET_RUN", "M0_API_SYNC_READ", "M0_API_SYNC_DISCARD", "M0_API_SYNC_CONFIRM"].includes(message?.type);
}

function createProbeSession(tabId) { const timestamp = new Date().toISOString(); return { status: "active", phase: "waiting-handshake", startedAt: timestamp, updatedAt: timestamp, mainReady: apiProbeMainTabs.has(tabId), bridgeReady: apiProbeBridgeTabs.has(tabId), capturedCount: 0, targetTabId: tabId }; }
function isActiveProbeSender(sender) { return Boolean(apiProbeSession?.status === "active" && sender.tab?.id === apiProbeSession.targetTabId); }
function updateProbeHandshake(tabId, key) { if (!isActiveProbeSender({ tab: { id: tabId } })) return; apiProbeSession[key] = true; apiProbeSession.phase = apiProbeSession.mainReady && apiProbeSession.bridgeReady ? "capturing" : "waiting-handshake"; apiProbeSession.updatedAt = new Date().toISOString(); chrome.runtime.sendMessage({ type: "M0_API_PROBE_UPDATED" }).catch(() => {}); }
function summarizeProbeSession() { if (!apiProbeSession) return { status: "inactive", phase: "inactive", mainReady: false, bridgeReady: false, capturedCount: 0, updatedAt: "" }; const { targetTabId: _targetTabId, ...safe } = apiProbeSession; return { ...safe, active: safe.status === "active" }; }

function sanitizeProbe(value) {
  if (!value || typeof value !== "object" || !/^\/[a-zA-Z0-9_./-]+$/.test(String(value.path || ""))) return null;
  const fields = (items) => Array.isArray(items) ? items.filter((item) => /^[\p{L}_][\p{L}\p{N}_.\[\]-]{0,180}$/u.test(String(item)) && !/cookie|token|auth|sign|user.?id|account/i.test(item)).slice(0, 180) : [];
  const safePath = (value) => fields([value])[0] || "";
  const relation = value.relation && typeof value.relation === "object" ? {
    source: ["none", "independent-interface", "album-content-derived"].includes(value.relation.source) ? value.relation.source : "none",
    derivedCount: Math.max(0, Math.min(1000000, Number(value.relation.derivedCount) || 0)),
    albumIdPath: safePath(value.relation.albumIdPath), noteIdPaths: fields(value.relation.noteIdPaths)
  } : { source: "none", derivedCount: 0, albumIdPath: "", noteIdPaths: [] };
  return { path: value.path, method: value.method === "POST" ? "POST" : "GET", queryFields: fields(value.queryFields), requestFields: fields(value.requestFields), responseFields: fields(value.responseFields), cursorType: safePath(value.cursorType) || "none", hasMoreField: Boolean(value.hasMoreField), count: Math.max(0, Math.min(9999, Number(value.count) || 0)), kind: ["favorites", "albums", "albumContent", "unknown"].includes(value.kind) ? value.kind : "unknown", needsDynamicSignature: Boolean(value.needsDynamicSignature), context: { currentPath: /^\/[a-zA-Z0-9_./-]*$/.test(String(value.context?.currentPath || "")) ? value.context.currentPath : "", isAlbumDetail: Boolean(value.context?.isAlbumDetail), albumIdSource: safePath(value.context?.albumIdSource) }, relation, example: { query: fields(value.example?.query), request: fields(value.example?.request), response: fields(value.example?.response) } };
}

function mergeProbe(previous, next) {
  const mergeFields = (left, right) => [...new Set([...left, ...right])].slice(0, 180);
  return { ...next, queryFields: mergeFields(previous.queryFields, next.queryFields), requestFields: mergeFields(previous.requestFields, next.requestFields), responseFields: mergeFields(previous.responseFields, next.responseFields), relation: next.relation.derivedCount >= previous.relation.derivedCount ? next.relation : previous.relation, needsDynamicSignature: previous.needsDynamicSignature || next.needsDynamicSignature };
}

function summarizeProbes() { return apiProbeRecords.map((probe) => ({ ...probe, queryFields: [...probe.queryFields], requestFields: [...probe.requestFields], responseFields: [...probe.responseFields], relation: { ...probe.relation, noteIdPaths: [...probe.relation.noteIdPaths] }, context: { ...probe.context }, example: { ...probe.example } })); }

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
