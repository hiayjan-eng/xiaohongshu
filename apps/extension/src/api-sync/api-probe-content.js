(() => {
  if (window.__collectionRevivalApiProbeBridgeInstalled) return;
  window.__collectionRevivalApiProbeBridgeInstalled = true;
  const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === "collection-revival-api-probe") send("M0_API_PROBE_RECORD", { probe: event.data.probe });
    if (event.data?.source === "collection-revival-api-probe-main" && event.data?.type === "MAIN_READY") send("M0_API_PROBE_MAIN_READY");
  });
  send("M0_API_PROBE_BRIDGE_READY");
  for (const delay of [0, 50, 250]) setTimeout(() => window.postMessage({ source: "collection-revival-api-probe-bridge", type: "BRIDGE_READY" }, location.origin), delay);
})();
