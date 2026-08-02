(() => {
  if (window.__collectionRevivalApiProbeInstalled) return;
  window.__collectionRevivalApiProbeInstalled = true;
  const MAX_KEYS = 30;
  const SENSITIVE = /cookie|token|authorization|signature|x-s|x-t|account|user.?id|phone|session/i;

  function keys(value) { return value && typeof value === "object" ? Object.keys(value).filter((key) => !SENSITIVE.test(key)).slice(0, MAX_KEYS) : []; }
  function findCursor(value) {
    if (!value || typeof value !== "object") return "none";
    for (const key of ["cursor", "page", "pageNum", "lastCursor", "nextCursor"]) if (key in value) return key;
    return "none";
  }
  function hasMore(value) {
    if (!value || typeof value !== "object") return false;
    return ["hasMore", "has_more", "hasNext", "more"].some((key) => key in value);
  }
  function classify(path, body, response) {
    const sample = `${path} ${keys(body).join(" ")} ${keys(response).join(" ")}`.toLowerCase();
    if (/fav|collect|favorite/.test(sample) && /album|board|collection/.test(sample)) return "memberships";
    if (/album|board|collection/.test(sample)) return "albums";
    if (/fav|collect|favorite/.test(sample)) return "favorites";
    return "unknown";
  }
  function safeJson(value) {
    if (!value || typeof value !== "string") return null;
    try { return JSON.parse(value); } catch { return null; }
  }
  function report(url, method, requestBody, response, headers) {
    try {
      const parsed = new URL(url, location.origin);
      if (!/xiaohongshu\.com$/.test(parsed.hostname)) return;
      const body = typeof requestBody === "string" ? safeJson(requestBody) : requestBody;
      const data = response?.data && typeof response.data === "object" ? response.data : response;
      const headerNames = headers && typeof headers.forEach === "function" ? (() => { const out = []; headers.forEach((_, key) => out.push(key)); return out; })() : [];
      window.postMessage({ source: "collection-revival-api-probe", probe: {
        path: parsed.pathname, method: String(method || "GET").toUpperCase(), requestFields: keys(body), responseFields: keys(data),
        cursorType: findCursor(data), hasMoreField: hasMore(data), count: Array.isArray(data?.items) ? data.items.length : Array.isArray(data?.list) ? data.list.length : 0,
        kind: classify(parsed.pathname, body, data), needsDynamicSignature: headerNames.some((key) => /^(x-s|x-t|x-sign|authorization)$/i.test(key)),
        example: { request: keys(body), response: keys(data) }
      } }, location.origin);
    } catch { /* Probe must never disrupt page requests. */ }
  }
  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await nativeFetch.apply(this, args);
    try {
      const request = args[0] instanceof Request ? args[0] : null;
      const init = args[1] || {};
      const clone = response.clone();
      const json = await clone.json();
      report(request?.url || args[0], init.method || request?.method || "GET", init.body, json, init.headers || request?.headers);
    } catch { /* Non-JSON endpoints are irrelevant. */ }
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__crProbe = { method, url }; return nativeOpen.call(this, method, url, ...rest); };
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) { (this.__crProbe ||= {}).headerNames ||= []; this.__crProbe.headerNames.push(String(name)); return nativeSetRequestHeader.call(this, name, value); };
  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener("loadend", () => { if (this.responseType && this.responseType !== "text") return; report(this.__crProbe?.url, this.__crProbe?.method, body, safeJson(this.responseText), { forEach: (callback) => (this.__crProbe?.headerNames || []).forEach((name) => callback("", name)) }); }, { once: true });
    return nativeSend.call(this, body);
  };
})();
