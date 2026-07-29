(() => {
  const BUILD_PROFILE = globalThis.__COLLECTION_REVIVAL_BUILD_PROFILE__ || {};
  const PROTOCOL_VERSION = "collection-revival-m0-preview-v1";
  const LEGACY_PROTOCOL_VERSION = "collection-revival-web-bridge-v1";
  const SOURCE_WEB = "collection-revival-web";
  const SOURCE_PREVIEW = "collection-revival-m0-preview-web";
  const SOURCE_EXTENSION = "collection-revival-extension";
  const TYPE_READY = "COLLECTION_REVIVAL_EXTENSION_READY";
  const TYPE_PING = "COLLECTION_REVIVAL_EXTENSION_PING";
  const TYPE_PONG = "COLLECTION_REVIVAL_EXTENSION_PONG";
  const TYPE_SCAN_STATUS_REQUEST = "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS_REQUEST";
  const TYPE_SCAN_STATUS = "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS";
  const SCAN_STATE_KEY = "revival-extension-scan-state";
  const PREVIEW_REQUEST_TYPES = new Set([
    "M0_PREVIEW_IMPORT_META_REQUEST",
    "M0_PREVIEW_IMPORT_CHUNK_REQUEST",
    "M0_PREVIEW_IMPORT_RESULT"
  ]);

  if (window.__collectionRevivalWebBridgeInstalled) {
    publishBridgeState();
    postReady();
    return;
  }

  assertAllowedOrigin();
  window.__collectionRevivalWebBridgeInstalled = true;
  window.__collectionRevivalWebBridgeProtocolVersion = PROTOCOL_VERSION;
  publishBridgeState();

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data || {};
    if (message.source === SOURCE_WEB && message.type === TYPE_PING) {
      publishBridgeState();
      postMessage(TYPE_PONG, message.requestId, { protocolVersion: LEGACY_PROTOCOL_VERSION });
      postScanStatus(message.requestId);
      return;
    }
    if (message.source === SOURCE_WEB && message.type === TYPE_SCAN_STATUS_REQUEST) {
      postScanStatus(message.requestId);
      return;
    }
    if (message.source !== SOURCE_PREVIEW || !PREVIEW_REQUEST_TYPES.has(message.type)) return;
    void forwardPreviewRequest(message);
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SCAN_STATE_KEY]) postReady();
  });

  postReady();
  window.setTimeout(postReady, 500);

  async function forwardPreviewRequest(message) {
    const response = await sendRuntimeMessage({
      type: message.type,
      importBatchId: String(message.importBatchId || ""),
      offset: Math.max(0, Number(message.offset) || 0),
      limit: Math.max(1, Math.min(Number(message.limit) || 200, 200)),
      result: message.result || undefined
    });
    window.postMessage({
      source: SOURCE_EXTENSION,
      type: "M0_PREVIEW_RESPONSE",
      requestId: message.requestId,
      requestType: message.type,
      protocolVersion: PROTOCOL_VERSION,
      response,
      timestamp: new Date().toISOString()
    }, window.location.origin);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  function postScanStatus(requestId) {
    try {
      chrome.storage.local.get(SCAN_STATE_KEY, (stored) => {
        window.postMessage({
          ...createPayload(TYPE_SCAN_STATUS, requestId),
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          scanState: stored?.[SCAN_STATE_KEY] || null
        }, window.location.origin);
      });
    } catch {
      window.postMessage({
        ...createPayload(TYPE_SCAN_STATUS, requestId),
        protocolVersion: LEGACY_PROTOCOL_VERSION,
        scanState: null,
        scanStatusError: "SCAN_STATE_UNAVAILABLE"
      }, window.location.origin);
    }
  }
  function postReady() {
    postMessage(TYPE_READY);
  }

  function publishBridgeState() {
    const payload = createPayload(TYPE_READY);
    const root = document.documentElement;
    root.dataset.collectionRevivalExtensionInstalled = "true";
    root.dataset.collectionRevivalExtensionVersion = payload.extensionVersion;
    root.dataset.collectionRevivalExtensionProtocolVersion = payload.protocolVersion;
    root.dataset.collectionRevivalExtensionBrowser = payload.browser;
    window.dispatchEvent(new CustomEvent("collection-revival-extension-bridge", { detail: payload }));
  }

  function postMessage(type, requestId, overrides = {}) {
    window.postMessage({ ...createPayload(type, requestId), ...overrides }, window.location.origin);
  }

  function createPayload(type, requestId) {
    const manifest = chrome.runtime.getManifest();
    return {
      source: SOURCE_EXTENSION,
      type,
      installed: true,
      requestId,
      extensionVersion: manifest.version_name || manifest.version,
      protocolVersion: PROTOCOL_VERSION,
      browser: detectBrowser(),
      buildProfile: BUILD_PROFILE.id || "unknown",
      capabilities: [
        "m0-full-scan",
        "side-panel",
        "checkpoint-restore",
        "preview-chunk-import",
        "import-batch-rollback",
        "original-link",
        "scan-progress-sync"
      ],
      timestamp: new Date().toISOString()
    };
  }

  function assertAllowedOrigin() {
    const origins = Array.isArray(BUILD_PROFILE.webAppOrigins) ? BUILD_PROFILE.webAppOrigins : [];
    if (!origins.includes(window.location.origin)) throw new Error("Current origin is not allowed by this extension build profile.");
  }

  function detectBrowser() {
    const ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    return "Other";
  }
})();
