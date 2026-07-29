importScripts("build-profile.js", "full-scan-idb.js");

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
  if (!isDatabaseMessage(message)) return false;
  void handleDatabaseMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

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
