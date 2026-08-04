(() => {
  const MAX_DEPTH = 5;
  const MAX_FIELDS = 180;
  const BLOCKED_PATH = /\/api\/(?:redcaptcha|sec)\/|\/data\/sem_sdk|analytics|tracking|report|\/log(?:\/|$)|ads|metrics/i;
  const SENSITIVE = /cookie|token|authorization|signature|account|user.?id|phone|session/i;
  const ALBUM = /(?:album|board|collection|favoritecollection|favcollection|专辑|收藏夹|合集)(?:_?id)?$/i;
  const NOTE = /(?:note|item|source|feed|post|笔记|作品|内容)(?:_?id)?$/i;
  const TITLE = /(?:title|name|标题|名称)$/i;
  const AUTHOR = /(?:author|nickname|creator|user.?name|作者)$/i;
  const COVER = /(?:cover|image|pic|thumbnail|封面|图片)$/i;
  const ORIGINAL_URL = /(?:url|link|share|original|链接|原帖)$/i;
  const CURSOR = /(?:cursor|page|nextcursor|lastcursor|游标|分页)/i;
  const MORE = /(?:hasmore|hasnext|more|下一页|更多)/i;

  function cleanPath(path) { return !SENSITIVE.test(path) ? path : ""; }
  function fieldPaths(value, root = "data") {
    const result = [];
    const walk = (node, path, depth) => {
      if (result.length >= MAX_FIELDS || depth > MAX_DEPTH || node == null) return;
      if (Array.isArray(node)) { const arrayPath = `${path}[]`; if (cleanPath(arrayPath)) result.push(arrayPath); node.slice(0, 12).forEach((item) => walk(item, arrayPath, depth + 1)); return; }
      if (typeof node !== "object") { if (path && cleanPath(path)) result.push(path); return; }
      Object.entries(node).forEach(([key, child]) => { const childPath = path ? `${path}.${key}` : key; if (!cleanPath(childPath)) return; result.push(childPath); walk(child, childPath, depth + 1); });
    };
    walk(value, root, 0);
    return [...new Set(result)].slice(0, MAX_FIELDS);
  }
  function valuesFor(value, root, matcher) {
    const result = [];
    const walk = (node, path, depth) => {
      if (result.length >= MAX_FIELDS || depth > MAX_DEPTH || node == null) return;
      if (Array.isArray(node)) { node.slice(0, 400).forEach((item) => walk(item, `${path}[]`, depth + 1)); return; }
      if (typeof node !== "object") return;
      Object.entries(node).forEach(([key, child]) => { const childPath = path ? `${path}.${key}` : key; if (!cleanPath(childPath)) return; if (matcher(childPath) && (typeof child === "string" || typeof child === "number")) result.push({ path: childPath, value: String(child) }); walk(child, childPath, depth + 1); });
    };
    walk(value, root, 0);
    return result;
  }
  function findArrays(value, root = "data") {
    const arrays = [];
    const walk = (node, path, depth) => {
      if (depth > MAX_DEPTH || node == null) return;
      if (Array.isArray(node)) { arrays.push({ path: `${path}[]`, items: node.slice(0, 400) }); return; }
      if (typeof node !== "object") return;
      Object.entries(node).forEach(([key, child]) => walk(child, path ? `${path}.${key}` : key, depth + 1));
    };
    walk(value, root, 0);
    return arrays;
  }
  function inspectArray(array) {
    const sample = array.items.filter((item) => item && typeof item === "object");
    if (!sample.length) return null;
    const fields = fieldPaths(sample[0], array.path);
    const notePath = fields.find((path) => NOTE.test(path)) || "";
    const albumPath = fields.find((path) => ALBUM.test(path)) || "";
    const hasTitle = fields.some((path) => TITLE.test(path));
    const hasAuthor = fields.some((path) => AUTHOR.test(path));
    const hasCover = fields.some((path) => COVER.test(path));
    const hasOriginalUrl = fields.some((path) => ORIGINAL_URL.test(path));
    const richNote = Boolean(notePath) && [hasTitle, hasAuthor, hasCover, hasOriginalUrl].filter(Boolean).length >= 2;
    const richAlbum = Boolean(albumPath) && (hasTitle || hasCover);
    return { path: array.path, length: array.items.length, fields, notePath, albumPath, richNote, richAlbum, noteValues: valuesFor(array.items, array.path, (path) => NOTE.test(path)) };
  }
  function parsePayload(body, documentBody = false) {
    const candidates = [];
    if (typeof body !== "string" || !body.trim()) return candidates;
    try { candidates.push({ value: JSON.parse(body), source: documentBody ? "document-ssr" : "network" }); } catch { /* HTML is inspected below. */ }
    if (documentBody) {
      const scripts = body.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
      for (const match of scripts) { try { candidates.push({ value: JSON.parse(match[1]), source: "hydration-script" }); } catch { /* Ignore non-JSON hydration scripts. */ } }
    }
    for (const candidate of [...candidates]) {
      const nested = [];
      const walk = (value, depth) => {
        if (depth > 4 || value == null) return;
        if (typeof value === "string" && /^[\[{]/.test(value.trim())) { try { nested.push(JSON.parse(value)); } catch { /* Not a JSON string. */ } return; }
        if (Array.isArray(value)) value.slice(0, 80).forEach((item) => walk(item, depth + 1));
        else if (typeof value === "object") Object.values(value).forEach((item) => walk(item, depth + 1));
      };
      walk(candidate.value, 0);
      nested.forEach((value) => candidates.push({ value, source: candidate.source === "network" ? "hydration-script" : candidate.source }));
    }
    return candidates;
  }
  function queryFields(url) { const parsed = new URL(url); return [...parsed.searchParams.keys()].filter((key) => !SENSITIVE.test(key)).map((key) => `query.${key}`); }
  function parseRequestBody(body) { if (!body) return {}; try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); } }
  function isXhs(url) { try { const host = new URL(url).hostname; return host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com"); } catch { return false; } }
  function sourceFor(targetType, payloadSource, resourceType) { if (payloadSource === "hydration-script") return "hydration-script"; if (resourceType === "Document") return "document-ssr"; if (targetType === "service_worker") return "network-service-worker"; if (targetType === "worker" || targetType === "shared_worker") return "network-worker"; return "network-page"; }
  function analyzeResponse(meta, rawBody, pairs) {
    const output = [];
    for (const payload of parsePayload(rawBody, meta.resourceType === "Document")) {
      const arrays = findArrays(payload.value).map(inspectArray).filter(Boolean);
      const paths = fieldPaths(payload.value);
      const albumsInRequest = valuesFor(meta.requestBody, "request", (path) => ALBUM.test(path));
      const albumsInQuery = valuesFor(meta.query, "query", (path) => ALBUM.test(path));
      const requestAlbum = [...albumsInQuery, ...albumsInRequest][0];
      for (const array of arrays) {
        let kind = "";
        if (requestAlbum && array.notePath) kind = "albumContent";
        else if (array.richAlbum) kind = "albums";
        else if (array.richNote) kind = "favorites";
        if (!kind) continue;
        let derivedCount = 0;
        if (kind === "albumContent") for (const note of array.noteValues) { pairs.add(`${requestAlbum.value}\u0000${note.value}`); derivedCount = pairs.size; }
        output.push({ hostname: new URL(meta.url).hostname, path: new URL(meta.url).pathname, method: meta.method, resourceType: meta.resourceType, initiatorType: meta.initiatorType, targetType: meta.targetType, status: meta.status, mimeType: meta.mimeType, queryFields: meta.queryFields, requestBodyFields: meta.requestBodyFields, responseFields: paths, arrayLength: array.length, cursorPath: paths.find((path) => CURSOR.test(path)) || "", hasMorePath: paths.find((path) => MORE.test(path)) || "", albumIdPath: requestAlbum?.path || array.albumPath, noteIdPath: array.notePath, titleAuthorCoverPaths: array.fields.filter((path) => TITLE.test(path) || AUTHOR.test(path) || COVER.test(path) || ORIGINAL_URL.test(path)), headerNames: meta.headerNames, needsDynamicSignature: meta.headerNames.some((name) => /^(x-s|x-t|x-sign)$/i.test(name)), kind, relationSource: kind === "albumContent" ? "album-content-derived" : "none", derivedCount, dataSource: sourceFor(meta.targetType, payload.source, meta.resourceType) });
      }
    }
    return output;
  }

  class BrowserNetworkProbe {
    constructor({ onUpdate = () => {} } = {}) { this.onUpdate = onUpdate; this.sessions = new Map(); this.onEvent = this.onEvent.bind(this); this.onDetach = this.onDetach.bind(this); chrome.debugger.onEvent.addListener(this.onEvent); chrome.debugger.onDetach.addListener(this.onDetach); }
    async start(tabId) {
      await chrome.debugger.attach({ tabId }, "1.3");
      const session = { tabId, attached: true, phase: "listening", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), candidates: [], filteredCount: 0, requests: new Map(), targets: new Map([["", "page"]]), pairs: new Set(), timer: null, reason: "" };
      this.sessions.set(tabId, session);
      try { await this.command({ tabId }, "Network.enable"); await this.command({ tabId }, "Page.enable"); await this.command({ tabId }, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); this.armTimeout(session); this.publish(session); return this.summary(session); } catch (error) { await this.stop(tabId, "error"); throw error; }
    }
    async stop(tabId, reason = "user") { const session = this.sessions.get(tabId); if (!session) return this.inactive(reason); clearTimeout(session.timer); this.sessions.delete(tabId); session.attached = false; session.phase = "disconnected"; session.reason = reason; session.updatedAt = new Date().toISOString(); session.pairs.clear(); try { await chrome.debugger.detach({ tabId }); } catch { /* Already detached or tab closed. */ } this.publish(session); return this.summary(session); }
    get(tabId) { return this.sessions.has(tabId) ? this.summary(this.sessions.get(tabId)) : this.inactive("inactive"); }
    inactive(reason) { return { active: false, attached: false, phase: "disconnected", reason, favoriteCount: 0, albumCount: 0, albumContentCount: 0, derivedMembershipCount: 0, filteredCount: 0, candidates: [], dataSources: [], needsDynamicSignature: false, updatedAt: "" }; }
    command(debuggee, method, params) { return chrome.debugger.sendCommand(debuggee, method, params); }
    armTimeout(session) { clearTimeout(session.timer); session.timer = setTimeout(() => { void this.stop(session.tabId, "timeout"); }, 45_000); }
    publish(session) { this.onUpdate(this.summary(session)); }
    summary(session) { const candidates = session.candidates.map((item) => ({ ...item, queryFields: [...item.queryFields], requestBodyFields: [...item.requestBodyFields], responseFields: [...item.responseFields], titleAuthorCoverPaths: [...item.titleAuthorCoverPaths], headerNames: [...item.headerNames] })); return { active: session.attached, attached: session.attached, phase: session.phase, reason: session.reason, favoriteCount: candidates.filter((item) => item.kind === "favorites").length, albumCount: candidates.filter((item) => item.kind === "albums").length, albumContentCount: candidates.filter((item) => item.kind === "albumContent").length, derivedMembershipCount: Math.max(0, ...candidates.map((item) => item.derivedCount || 0)), filteredCount: session.filteredCount, candidates, dataSources: [...new Set(candidates.map((item) => item.dataSource))], needsDynamicSignature: candidates.some((item) => item.needsDynamicSignature), updatedAt: session.updatedAt }; }
    async onEvent(debuggee, method, params) {
      const session = this.sessions.get(debuggee.tabId); if (!session) return;
      const targetKey = debuggee.sessionId || "";
      if (method === "Target.attachedToTarget") { const type = params.targetInfo?.type || "worker"; session.targets.set(params.sessionId, type); try { await this.command({ tabId: debuggee.tabId, sessionId: params.sessionId }, "Network.enable"); await this.command({ tabId: debuggee.tabId, sessionId: params.sessionId }, "Page.enable"); } catch { /* Some worker targets do not expose every domain. */ } return; }
      if (method === "Target.detachedFromTarget") { session.targets.delete(params.sessionId); return; }
      if (method === "Network.requestWillBeSent") { const request = params.request || {}; if (!isXhs(request.url)) return; const parsed = new URL(request.url); if (BLOCKED_PATH.test(parsed.pathname)) { session.filteredCount += 1; session.updatedAt = new Date().toISOString(); this.publish(session); return; } const key = `${targetKey}\u0000${params.requestId}`; const requestBody = parseRequestBody(request.postData || ""); const meta = { url: request.url, method: request.method || "GET", resourceType: params.type || "Other", initiatorType: params.initiator?.type || "other", targetType: session.targets.get(targetKey) || "page", query: Object.fromEntries([...parsed.searchParams.entries()].filter(([key]) => !SENSITIVE.test(key))), queryFields: queryFields(request.url), requestBody, requestBodyFields: fieldPaths(requestBody, "request"), headerNames: Object.keys(request.headers || {}).filter((name) => !SENSITIVE.test(name)).map((name) => name.toLowerCase()) }; session.requests.set(key, meta); if (!request.postData && request.hasPostData) this.command(debuggee, "Network.getRequestPostData", { requestId: params.requestId }).then((value) => { const body = parseRequestBody(value?.postData || ""); meta.requestBody = body; meta.requestBodyFields = fieldPaths(body, "request"); }).catch(() => {}); return; }
      if (method === "Network.responseReceived") { const key = `${targetKey}\u0000${params.requestId}`; const meta = session.requests.get(key); if (!meta) return; Object.assign(meta, { status: params.response?.status || 0, mimeType: params.response?.mimeType || "" }); if (meta.resourceType === "Document") { session.phase = "checking-ssr"; this.publish(session); } return; }
      if (method === "Network.loadingFinished") { const key = `${targetKey}\u0000${params.requestId}`; const meta = session.requests.get(key); session.requests.delete(key); if (!meta || !["XHR", "Fetch", "Document", "Other"].includes(meta.resourceType)) return; if (!/json|javascript|html|text/i.test(meta.mimeType || "")) return; try { const body = await this.command(debuggee, "Network.getResponseBody", { requestId: params.requestId }); let raw = body?.base64Encoded ? atob(body.body || "") : body?.body || ""; const candidates = analyzeResponse(meta, raw, session.pairs); raw = ""; if (candidates.length) { session.candidates.push(...candidates); session.phase = "found"; session.updatedAt = new Date().toISOString(); this.armTimeout(session); this.publish(session); } } catch { /* Response bodies can disappear before inspection. */ } }
    }
    onDetach(debuggee, reason) { const session = this.sessions.get(debuggee.tabId); if (!session) return; clearTimeout(session.timer); this.sessions.delete(debuggee.tabId); session.attached = false; session.phase = "disconnected"; session.reason = reason || "detached"; session.pairs.clear(); this.publish(session); }
  }
  globalThis.CollectionRevivalCdpNetworkProbe = { BrowserNetworkProbe, analyzeResponse, BLOCKED_PATH };
})();
