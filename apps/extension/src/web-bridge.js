(() => {
  const PROTOCOL_VERSION = "collection-revival-web-bridge-v1";
  const SOURCE_WEB = "collection-revival-web";
  const SOURCE_EXTENSION = "collection-revival-extension";
  const TYPE_READY = "COLLECTION_REVIVAL_EXTENSION_READY";
  const TYPE_PING = "COLLECTION_REVIVAL_EXTENSION_PING";
  const TYPE_PONG = "COLLECTION_REVIVAL_EXTENSION_PONG";

  if (window.__collectionRevivalWebBridgeInstalled) {
    postReady();
    return;
  }

  window.__collectionRevivalWebBridgeInstalled = true;
  window.__collectionRevivalWebBridgeProtocolVersion = PROTOCOL_VERSION;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const message = event.data || {};
    if (message.source !== SOURCE_WEB) return;
    if (message.type !== TYPE_PING) return;

    postMessage(TYPE_PONG, message.requestId);
  });

  postReady();
  window.setTimeout(postReady, 600);

  function postReady() {
    postMessage(TYPE_READY);
  }

  function postMessage(type, requestId) {
    window.postMessage({
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
        "import-payload"
      ],
      timestamp: new Date().toISOString()
    }, window.location.origin);
  }

  function detectBrowser() {
    const ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    return "Other";
  }
})();
