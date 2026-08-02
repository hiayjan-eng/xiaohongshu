(() => {
  if (window.__collectionRevivalApiProbeInstalled) return;
  window.__collectionRevivalApiProbeInstalled = true;
  const MAX_DEPTH = 5;
  const MAX_PATHS = 180;
  const SENSITIVE = /cookie|token|authorization|signature|x-s|x-t|account|user.?id|phone|session/i;
  const ALBUM = /(?:^|[._\[])(?:album|board|collection|favoritecollection|favcollection|专辑|收藏夹|合集)(?:_?id|编号)?$/i;
  const NOTE = /(?:^|[._\[])(?:note|item|source|feed|post|笔记|作品|内容)(?:_?id|编号)?$/i;
  const NOTE_ARRAY = /(?:items|notes|list|feeds|cards|笔记|作品|内容)\[\]/i;
  const CURSOR = /(?:cursor|page|nextcursor|lastcursor|游标|分页)/i;
  const MORE = /(?:hasmore|hasnext|more|下一页|更多)/i;
  const transientMemberships = new Map();
  let nativeFetch = window.fetch;
  let nativeOpen = XMLHttpRequest.prototype.open;
  let nativeSend = XMLHttpRequest.prototype.send;
  let nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  function isSensitive(path) { return SENSITIVE.test(path); }
  function fieldPaths(value, root) {
    const paths = [];
    const visit = (node, path, depth) => {
      if (paths.length >= MAX_PATHS || depth > MAX_DEPTH || node == null) return;
      if (Array.isArray(node)) {
        const arrayPath = `${path}[]`;
        if (!isSensitive(arrayPath)) paths.push(arrayPath);
        node.slice(0, 8).forEach((item) => visit(item, arrayPath, depth + 1));
        return;
      }
      if (typeof node !== "object") { if (path && !isSensitive(path)) paths.push(path); return; }
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSensitive(childPath)) continue;
        paths.push(childPath);
        visit(child, childPath, depth + 1);
      }
    };
    visit(value, root, 0);
    return [...new Set(paths)].slice(0, MAX_PATHS);
  }
  function semanticValues(value, root, matcher) {
    const values = [];
    const visit = (node, path, depth) => {
      if (values.length >= MAX_PATHS || depth > MAX_DEPTH || node == null) return;
      if (Array.isArray(node)) { node.slice(0, 200).forEach((item) => visit(item, `${path}[]`, depth + 1)); return; }
      if (typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSensitive(childPath)) continue;
        if (matcher(childPath) && (typeof child === "string" || typeof child === "number")) values.push({ path: childPath, value: String(child) });
        visit(child, childPath, depth + 1);
      }
    };
    visit(value, root, 0);
    return values;
  }
  function queryPayload(url) {
    const result = {};
    for (const [key, value] of url.searchParams.entries()) if (!isSensitive(`query.${key}`)) result[key] = value;
    return result;
  }
  function parseBody(value) {
    if (value == null) return {};
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return Object.fromEntries(new URLSearchParams(value)); }
    }
    if (value instanceof URLSearchParams) return Object.fromEntries(value.entries());
    if (value instanceof FormData) return Object.fromEntries([...value.entries()].filter(([key]) => !isSensitive(`request.${key}`)).map(([key, item]) => [key, typeof item === "string" ? item : "[binary]"]));
    return value && typeof value === "object" ? value : {};
  }
  function headersNeedSignature(headers) {
    const names = [];
    headers?.forEach?.((_value, key) => names.push(String(key)));
    return names.some((key) => /^(x-s|x-t|x-sign|authorization)$/i.test(key));
  }
  function firstField(paths, matcher) { return paths.find((path) => matcher(path)) || ""; }
  function classify(requestFields, responseFields, requestAlbums, responseAlbums, responseNotes) {
    if (requestAlbums.length && responseNotes.length) return "albumContent";
    if (responseAlbums.length || responseFields.some((path) => ALBUM.test(path))) return "albums";
    if (responseNotes.length || responseFields.some((path) => NOTE_ARRAY.test(path))) return "favorites";
    if (requestFields.some((path) => /(?:fav|collect|favorite|收藏)/i.test(path))) return "favorites";
    return "unknown";
  }
  function analyzeProbe(urlValue, method, rawBody, response, headers) {
    const url = new URL(urlValue, location.origin);
    const query = queryPayload(url);
    const body = parseBody(rawBody);
    const data = response?.data && typeof response.data === "object" ? response.data : response || {};
    const queryFields = fieldPaths(query, "query");
    const requestFields = fieldPaths(body, "request");
    const responseFields = fieldPaths(data, "data");
    const requestAlbums = [...semanticValues(query, "query", (path) => ALBUM.test(path)), ...semanticValues(body, "request", (path) => ALBUM.test(path))];
    const responseAlbums = semanticValues(data, "data", (path) => ALBUM.test(path));
    const responseNotes = semanticValues(data, "data", (path) => NOTE.test(path)).filter((entry) => entry.path.includes("[]") || responseFields.some((path) => NOTE_ARRAY.test(path)));
    const album = requestAlbums[0];
    let relation = { source: "none", derivedCount: transientMemberships.size, albumIdPath: "", noteIdPaths: [] };
    if (album && responseNotes.length) {
      for (const note of responseNotes) transientMemberships.set(`${album.value}\u0000${note.value}`, { albumId: album.value, noteId: note.value });
      relation = { source: "album-content-derived", derivedCount: transientMemberships.size, albumIdPath: album.path, noteIdPaths: [...new Set(responseNotes.map((note) => note.path))].slice(0, 12) };
    }
    const current = new URL(location.href);
    const context = { currentPath: current.pathname, isAlbumDetail: Boolean(album) || /album|board|collection|专辑|收藏夹|合集/i.test(`${current.pathname} ${current.search}`), albumIdSource: album?.path || "" };
    return {
      path: url.pathname, method: String(method || "GET").toUpperCase(), queryFields, requestFields, responseFields,
      cursorType: firstField([...queryFields, ...requestFields, ...responseFields], (path) => CURSOR.test(path)) || "none",
      hasMoreField: [...responseFields].some((path) => MORE.test(path)), count: responseNotes.length,
      kind: classify(requestFields, responseFields, requestAlbums, responseAlbums, responseNotes), needsDynamicSignature: headersNeedSignature(headers),
      context, relation, example: { query: queryFields, request: requestFields, response: responseFields }
    };
  }
  async function bodyForFetch(request, init) {
    if (init?.body !== undefined) return init.body;
    if (!request?.clone) return null;
    try { return await request.clone().text(); } catch { return null; }
  }
  function report(url, method, requestBody, response, headers) {
    try {
      const parsed = new URL(url, location.origin);
      if (!/xiaohongshu\.com$/.test(parsed.hostname)) return;
      window.postMessage({ source: "collection-revival-api-probe", probe: analyzeProbe(parsed.href, method, requestBody, response, headers) }, location.origin);
    } catch { /* Probe must never disrupt page requests. */ }
  }
  const fetchProbe = async function (...args) {
    const request = args[0] instanceof Request ? args[0] : null;
    const init = args[1] || {};
    const body = await bodyForFetch(request, init);
    const response = await nativeFetch.apply(this, args);
    try { report(request?.url || args[0], init.method || request?.method || "GET", body, await response.clone().json(), init.headers || request?.headers); } catch { /* Non-JSON endpoints are irrelevant. */ }
    return response;
  };
  const xhrOpenProbe = function (method, url, ...rest) { this.__crProbe = { method, url, headerNames: [] }; return nativeOpen.call(this, method, url, ...rest); };
  const xhrSetRequestHeaderProbe = function (name, value) { (this.__crProbe ||= { headerNames: [] }).headerNames.push(String(name)); return nativeSetRequestHeader.call(this, name, value); };
  const xhrSendProbe = function (body) {
    this.addEventListener("loadend", () => { if (this.responseType && this.responseType !== "text") return; let response; try { response = JSON.parse(this.responseText); } catch { return; } report(this.__crProbe?.url, this.__crProbe?.method, body, response, { forEach: (callback) => (this.__crProbe?.headerNames || []).forEach((name) => callback("", name)) }); }, { once: true });
    return nativeSend.call(this, body);
  };
  function repairTransportHooks() {
    if (window.fetch !== fetchProbe) nativeFetch = window.fetch;
    window.fetch = fetchProbe;
    if (XMLHttpRequest.prototype.open !== xhrOpenProbe) nativeOpen = XMLHttpRequest.prototype.open;
    if (XMLHttpRequest.prototype.send !== xhrSendProbe) nativeSend = XMLHttpRequest.prototype.send;
    if (XMLHttpRequest.prototype.setRequestHeader !== xhrSetRequestHeaderProbe) nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = xhrOpenProbe;
    XMLHttpRequest.prototype.send = xhrSendProbe;
    XMLHttpRequest.prototype.setRequestHeader = xhrSetRequestHeaderProbe;
  }
  function announceReady() { window.postMessage({ source: "collection-revival-api-probe-main", type: "MAIN_READY" }, location.origin); }
  window.addEventListener("message", (event) => { if (event.source === window && event.origin === location.origin && event.data?.source === "collection-revival-api-probe-bridge" && event.data?.type === "BRIDGE_READY") announceReady(); });
  repairTransportHooks();
  announceReady();
  setInterval(repairTransportHooks, 250);
  globalThis.__collectionRevivalApiProbeTest = { analyzeProbe, repairTransportHooks };
})();
