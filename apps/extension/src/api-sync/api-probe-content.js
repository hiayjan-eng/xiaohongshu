(() => {
  if (window.__collectionRevivalApiProbeBridgeInstalled) return;
  window.__collectionRevivalApiProbeBridgeInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "collection-revival-api-probe") return;
    chrome.runtime.sendMessage({ type: "M0_API_PROBE_RECORD", probe: event.data.probe }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "M0_API_PROBE_START") return false;
    chrome.runtime.sendMessage({ type: "M0_API_PROBE_START" })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();
