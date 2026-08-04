import vm from "node:vm";
import { readFileSync } from "node:fs";

let onEvent;
let onDetach;
const detachCalls = [];
const bodies = new Map();
const updates = [];
const chrome = { debugger: {
  onEvent: { addListener(listener) { onEvent = listener; } },
  onDetach: { addListener(listener) { onDetach = listener; } },
  async attach() {},
  async detach(debuggee) { detachCalls.push(debuggee.tabId); },
  async sendCommand(_debuggee, method, params) {
    if (method === "Network.getResponseBody") return { body: bodies.get(params.requestId) || "", base64Encoded: false };
    if (method === "Network.getRequestPostData") return { postData: "" };
    return {};
  }
} };
const context = { chrome, URL, URLSearchParams, Map, Set, JSON, Object, Array, String, Number, RegExp, Date, atob, setTimeout: () => 1, clearTimeout() {}, globalThis: null };
context.globalThis = context;
vm.runInNewContext(readFileSync(new URL("../src/api-sync/cdp-network-probe.js", import.meta.url), "utf8"), context);
const { BrowserNetworkProbe } = context.CollectionRevivalCdpNetworkProbe;
const { analyzeResponse } = context.CollectionRevivalCdpNetworkProbe;
const probe = new BrowserNetworkProbe({ onUpdate: (state) => updates.push(state) });
await probe.start(7);
const page = { tabId: 7 };
async function request(debuggee, requestId, url, type, body, headers = {}) {
  bodies.set(requestId, body);
  await onEvent(debuggee, "Network.requestWillBeSent", { requestId, type, initiator: { type: "script" }, request: { url, method: "GET", headers } });
  await onEvent(debuggee, "Network.responseReceived", { requestId, response: { status: 200, mimeType: type === "Document" ? "text/html" : "application/json" } });
  await onEvent(debuggee, "Network.loadingFinished", { requestId });
}
const favorite = JSON.stringify({ data: { items: [{ noteId: "real-note-a", title: "real title", author: "real author", cover: "real cover" }], cursor: "next", hasMore: true } });
const directCandidate = analyzeResponse({ url: "https://www.xiaohongshu.com/api/data", method: "GET", resourceType: "XHR", initiatorType: "script", targetType: "page", status: 200, mimeType: "application/json", query: {}, queryFields: [], requestBody: {}, requestBodyFields: [], headerNames: [] }, favorite, new Set());
if (!directCandidate.length) throw new Error("direct CDP body analyzer did not recognize a favorite array");
await request(page, "page-xhr", "https://www.xiaohongshu.com/api/data", "XHR", favorite);
await onEvent(page, "Target.attachedToTarget", { sessionId: "worker", targetInfo: { type: "worker" } });
await request({ tabId: 7, sessionId: "worker" }, "worker-xhr", "https://www.xiaohongshu.com/api/worker", "Fetch", favorite);
await onEvent(page, "Target.attachedToTarget", { sessionId: "service", targetInfo: { type: "service_worker" } });
const albums = JSON.stringify({ data: { list: [{ collectionId: "real-album", name: "real name", cover: "real cover" }] } });
await request({ tabId: 7, sessionId: "service" }, "service-xhr", "https://www.xiaohongshu.com/api/service", "XHR", albums);
const ssr = `<html><script type="application/json">${favorite}</script></html>`;
await request(page, "document", "https://www.xiaohongshu.com/collection", "Document", ssr);
await request(page, "captcha", "https://www.xiaohongshu.com/api/redcaptcha/v2/getconfig", "XHR", favorite, { "x-s": "secret", "x-t": "secret" });
await request(page, "sec", "https://www.xiaohongshu.com/api/sec/v1/scripting", "XHR", favorite);
await request(page, "sem", "https://www.xiaohongshu.com/data/sem_sdk", "XHR", favorite);
const result = probe.get(7);
if (result.favoriteCount < 3 || result.albumCount < 1 || result.filteredCount !== 3) throw new Error(`CDP candidate classification failed: ${JSON.stringify(result)}`);
for (const source of ["network-page", "network-worker", "network-service-worker", "hydration-script"]) if (!result.dataSources.includes(source)) throw new Error(`Missing data source: ${source}`);
if (result.needsDynamicSignature) throw new Error("security SDK signature must not mark business candidates as signed");
if (/real-note|real-album|secret|real title/.test(JSON.stringify(result))) throw new Error("raw body, ID, header values, or user text escaped sanitized memory");
await probe.stop(7, "complete");
await probe.start(8);
await probe.stop(8, "cancel");
const originalCommand = chrome.debugger.sendCommand;
chrome.debugger.sendCommand = async (_debuggee, method) => { if (method === "Network.enable") throw new Error("forced CDP failure"); return {}; };
const brokenProbe = new BrowserNetworkProbe({ onUpdate: () => {} });
await brokenProbe.start(9).then(() => { throw new Error("forced debugger failure was ignored"); }, () => {});
chrome.debugger.sendCommand = originalCommand;
onDetach({ tabId: 7 }, "target_closed");
if (![7, 8, 9].every((tabId) => detachCalls.includes(tabId)) || !updates.some((state) => state.reason === "complete")) throw new Error("detach must run on completion, cancellation, and exceptions");
console.log("M0 CDP tests ok: page, worker, service worker, SSR, filtering, sanitization, detach");
