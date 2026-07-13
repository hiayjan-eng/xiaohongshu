(() => {
  const PROTOCOL_VERSION = "collection-revival-web-bridge-v1";
  const SOURCE_WEB = "collection-revival-web";
  const SOURCE_EXTENSION = "collection-revival-extension";
  const TYPE_READY = "COLLECTION_REVIVAL_EXTENSION_READY";
  const TYPE_PING = "COLLECTION_REVIVAL_EXTENSION_PING";
  const TYPE_PONG = "COLLECTION_REVIVAL_EXTENSION_PONG";
  const TYPE_SCAN_STATUS_REQUEST = "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS_REQUEST";
  const TYPE_SCAN_STATUS = "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS";
  const SCAN_STATE_KEY = "revival-extension-scan-state";

  if (window.__collectionRevivalWebBridgeInstalled) {
    publishBridgeState();
    postReady();
    return;
  }

  window.__collectionRevivalWebBridgeInstalled = true;
  window.__collectionRevivalWebBridgeProtocolVersion = PROTOCOL_VERSION;
  publishBridgeState();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const message = event.data || {};
    if (message.source !== SOURCE_WEB) return;
    if (message.type === TYPE_PING) {
      publishBridgeState();
      postMessage(TYPE_PONG, message.requestId);
      postScanStatus(message.requestId);
      return;
    }

    if (message.type === TYPE_SCAN_STATUS_REQUEST) {
      publishBridgeState();
      postScanStatus(message.requestId);
    }
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SCAN_STATE_KEY]) {
      postScanStatus();
    }
  });

  postReady();
  window.setTimeout(postReady, 600);
  window.setTimeout(() => postScanStatus(), 900);

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

  function postMessage(type, requestId) {
    window.postMessage(createPayload(type, requestId), window.location.origin);
  }

  function postScanStatus(requestId) {
    try {
      chrome.storage.local.get(SCAN_STATE_KEY, (stored) => {
        window.postMessage({
          ...createPayload(TYPE_SCAN_STATUS, requestId),
          scanState: stored?.[SCAN_STATE_KEY] || null
        }, window.location.origin);
      });
    } catch {
      window.postMessage({
        ...createPayload(TYPE_SCAN_STATUS, requestId),
        scanState: null,
        scanStatusError: "SCAN_STATE_UNAVAILABLE"
      }, window.location.origin);
    }
  }

  function createPayload(type, requestId) {
    return {
      source: SOURCE_EXTENSION,
      type,
      installed: true,
      requestId,
      extensionVersion: chrome.runtime.getManifest().version,
      protocolVersion: PROTOCOL_VERSION,
      browser: detectBrowser(),
      capabilities: [
        "web-bridge",
        "ping-pong-handshake",
        "xhs-visible-dom-scan",
        "auto-scroll",
        "pause-resume",
        "checkpoint-restore",
        "import-payload",
        "scan-progress-sync"
      ],
      timestamp: new Date().toISOString()
    };
  }

  function detectBrowser() {
    const ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    return "Other";
  }
})();
