(() => {
  const DB_NAME = "collection-revival-m0-preview-v1";
  const DB_VERSION = 1;
  const RECORD_STORE = "records";
  const BATCH_STORE = "importBatches";
  const SOURCE_WEB = "collection-revival-m0-preview-web";
  const SOURCE_EXTENSION = "collection-revival-extension";
  const CHUNK_LIMIT = 200;

  const elements = Object.fromEntries([
    "connectionBadge", "importTitle", "extensionVersion", "totalCount", "newCount",
    "existingCount", "reviewCount", "importStatus", "confirmImport", "rollbackImport",
    "libraryCount", "libraryMessage", "libraryList"
  ].map((id) => [id, document.getElementById(id)]));
  const pendingRequests = new Map();
  const importBatchId = new URLSearchParams(location.search).get("importBatchId") || "";
  let databasePromise;
  let importMeta = null;
  let importSummary = null;
  let importing = false;

  window.addEventListener("message", handleExtensionResponse);
  elements.confirmImport.addEventListener("click", () => void confirmImport());
  elements.rollbackImport.addEventListener("click", () => void rollbackImport());
  elements.libraryList.addEventListener("click", (event) => void openOriginalFromEvent(event));

  globalThis.CollectionRevivalM0Preview = {
    DB_NAME,
    analyzeImport,
    buildDedupeKey,
    confirmBatchImport,
    openDatabase,
    resolveOriginalUrl,
    rollbackBatch,
    stableHash
  };

  void initialize();

  async function initialize() {
    await openDatabase();
    await renderLibrary();
    if (!importBatchId) return fail("链接中没有本地导入批次。请回到扩展 Side Panel，扫描完成后点击“导入收藏复活”。");
    try {
      const response = await requestExtension("M0_PREVIEW_IMPORT_META_REQUEST", { importBatchId });
      if (!response?.ok || !response.meta) throw new Error(response?.error || "扩展未返回导入批次。");
      importMeta = response.meta;
      elements.connectionBadge.dataset.state = "ready";
      elements.connectionBadge.textContent = "扩展已连接";
      elements.extensionVersion.textContent = importMeta.extensionVersion;
      const localBatch = await getBatch(importBatchId);
      if (localBatch?.status === "imported") {
        importSummary = localBatch.result;
        renderSummary({
          totalCount: localBatch.totalCount,
          newCount: localBatch.result.importedCount,
          existingCount: localBatch.result.existingCount,
          reviewCount: localBatch.result.reviewCount
        });
        elements.importTitle.textContent = "本批次已导入";
        elements.importStatus.textContent = `导入时间：${formatDate(localBatch.importedAt)}。你可以只撤销这个 importBatchId。`;
        elements.rollbackImport.disabled = false;
        return;
      }
      importSummary = await analyzeImport(importMeta);
      renderSummary(importSummary);
      elements.importTitle.textContent = "请核对本次导入";
      elements.importStatus.textContent = "数量已按 Preview 独立 IndexedDB 重新核对。确认前不会写入收藏库。";
      elements.confirmImport.disabled = false;
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  async function analyzeImport(meta) {
    let offset = 0;
    let totalCount = 0;
    let newCount = 0;
    let existingCount = 0;
    const incomingKeys = new Set();
    while (true) {
      const response = await requestExtension("M0_PREVIEW_IMPORT_CHUNK_REQUEST", {
        importBatchId: meta.importBatchId,
        offset,
        limit: CHUNK_LIMIT
      });
      if (!response?.ok || !response.chunk) throw new Error(response?.error || "读取本地导入分块失败。");
      const chunk = response.chunk;
      const counts = await countChunk(chunk.items || [], incomingKeys);
      totalCount += counts.totalCount;
      newCount += counts.newCount;
      existingCount += counts.existingCount;
      if (!chunk.hasMore || chunk.nextOffset <= offset) break;
      offset = chunk.nextOffset;
    }
    return { totalCount, newCount, existingCount, reviewCount: Math.max(0, Number(meta.reviewCount) || 0) };
  }

  async function countChunk(items, incomingKeys) {
    const database = await openDatabase();
    const transaction = database.transaction(RECORD_STORE, "readonly");
    const store = transaction.objectStore(RECORD_STORE);
    let newCount = 0;
    let existingCount = 0;
    let totalCount = 0;
    for (const item of items) {
      const normalized = normalizeRecord(item);
      const key = buildDedupeKey(normalized);
      if (!key || incomingKeys.has(key)) {
        existingCount += 1;
        totalCount += 1;
        continue;
      }
      incomingKeys.add(key);
      const existing = await requestResult(store.get(key));
      if (existing) existingCount += 1;
      else newCount += 1;
      totalCount += 1;
    }
    await transactionDone(transaction);
    return { totalCount, newCount, existingCount };
  }

  async function confirmImport() {
    if (!importMeta || importing) return;
    importing = true;
    elements.confirmImport.disabled = true;
    elements.importStatus.textContent = "正在从扩展分块写入 Preview IndexedDB…";
    try {
      const result = await confirmBatchImport(importMeta, (progress) => {
        elements.importStatus.textContent = `正在导入：${formatNumber(progress.processed)} / ${formatNumber(progress.total)}。`;
      });
      importSummary = result;
      renderSummary({
        totalCount: result.totalCount,
        newCount: result.importedCount,
        existingCount: result.existingCount,
        reviewCount: result.reviewCount
      });
      elements.importTitle.textContent = "导入完成";
      elements.importStatus.textContent = `批次 ${maskId(importMeta.importBatchId)} 已完成；刷新页面后数量仍会保留。`;
      elements.rollbackImport.disabled = false;
      await requestExtension("M0_PREVIEW_IMPORT_RESULT", {
        importBatchId: importMeta.importBatchId,
        result: {
          status: "imported",
          importedAt: result.importedAt,
          importedCount: result.importedCount,
          existingCount: result.existingCount,
          reviewCount: result.reviewCount
        }
      });
      await renderLibrary();
    } catch (error) {
      elements.importStatus.textContent = `导入安全停止：${error instanceof Error ? error.message : String(error)}`;
      elements.rollbackImport.disabled = false;
    } finally {
      importing = false;
    }
  }

  async function confirmBatchImport(meta, onProgress = () => {}) {
    const importedAt = new Date().toISOString();
    const initialBatch = {
      importBatchId: meta.importBatchId,
      scanSessionId: meta.scanSessionId,
      extensionVersion: meta.extensionVersion,
      importedAt,
      status: "importing",
      totalCount: meta.totalCount,
      result: { importedCount: 0, existingCount: 0, reviewCount: Math.max(0, Number(meta.reviewCount) || 0) }
    };
    await putBatch(initialBatch);
    let offset = 0;
    let processed = 0;
    let importedCount = 0;
    let existingCount = 0;
    while (true) {
      const response = await requestExtension("M0_PREVIEW_IMPORT_CHUNK_REQUEST", {
        importBatchId: meta.importBatchId,
        offset,
        limit: CHUNK_LIMIT
      });
      if (!response?.ok || !response.chunk) throw new Error(response?.error || "读取导入分块失败。");
      const chunk = response.chunk;
      const result = await persistChunk(chunk.items || [], meta, importedAt);
      processed += result.processed;
      importedCount += result.importedCount;
      existingCount += result.existingCount;
      onProgress({ processed, total: meta.totalCount });
      if (!chunk.hasMore || chunk.nextOffset <= offset) break;
      offset = chunk.nextOffset;
    }
    const finalBatch = {
      ...initialBatch,
      status: "imported",
      result: { importedCount, existingCount, reviewCount: initialBatch.result.reviewCount }
    };
    await putBatch(finalBatch);
    return { totalCount: processed, importedCount, existingCount, reviewCount: finalBatch.result.reviewCount, importedAt };
  }

  async function persistChunk(items, meta, importedAt) {
    const database = await openDatabase();
    const transaction = database.transaction(RECORD_STORE, "readwrite");
    const store = transaction.objectStore(RECORD_STORE);
    let importedCount = 0;
    let existingCount = 0;
    let processed = 0;
    for (const item of items) {
      const record = normalizeRecord(item);
      const dedupeKey = buildDedupeKey(record);
      if (!dedupeKey) continue;
      const existing = await requestResult(store.get(dedupeKey));
      if (existing) {
        existingCount += 1;
      } else {
        store.add({
          ...record,
          dedupeKey,
          scanSessionId: meta.scanSessionId,
          importBatchId: meta.importBatchId,
          extensionVersion: meta.extensionVersion,
          importedAt
        });
        importedCount += 1;
      }
      processed += 1;
    }
    await transactionDone(transaction);
    return { processed, importedCount, existingCount };
  }

  async function rollbackImport() {
    if (!importMeta || importing || !window.confirm("只撤销当前 importBatchId 导入的新增收藏，不影响其他批次。确定继续吗？")) return;
    elements.rollbackImport.disabled = true;
    const removedCount = await rollbackBatch(importMeta.importBatchId);
    await requestExtension("M0_PREVIEW_IMPORT_RESULT", {
      importBatchId: importMeta.importBatchId,
      result: { status: "rolled_back", importedAt: new Date().toISOString(), importedCount: 0, existingCount: 0, reviewCount: importMeta.reviewCount }
    });
    elements.importTitle.textContent = "本批次已撤销";
    elements.importStatus.textContent = `已删除当前批次新增的 ${formatNumber(removedCount)} 条；其他批次未受影响。`;
    elements.confirmImport.disabled = false;
    await renderLibrary();
  }

  async function rollbackBatch(batchId) {
    const database = await openDatabase();
    const transaction = database.transaction([RECORD_STORE, BATCH_STORE], "readwrite");
    const records = transaction.objectStore(RECORD_STORE);
    const keys = await requestResult(records.index("importBatchId").getAllKeys(IDBKeyRange.only(batchId)));
    keys.forEach((key) => records.delete(key));
    const batches = transaction.objectStore(BATCH_STORE);
    const batch = await requestResult(batches.get(batchId));
    if (batch) batches.put({ ...batch, status: "rolled_back", rolledBackAt: new Date().toISOString() });
    await transactionDone(transaction);
    return keys.length;
  }

  async function renderLibrary() {
    const database = await openDatabase();
    const transaction = database.transaction(RECORD_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(RECORD_STORE).getAll());
    await transactionDone(transaction);
    records.sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
    elements.libraryCount.textContent = `${formatNumber(records.length)} 条`;
    elements.libraryList.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "还没有导入收藏。";
      elements.libraryList.append(empty);
      return;
    }
    records.slice(0, 100).forEach((record, index) => {
      const row = document.createElement("li");
      const image = document.createElement("img");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const open = document.createElement("button");
      image.alt = "";
      image.loading = "lazy";
      if (isSafeImageUrl(record.coverUrl)) image.src = record.coverUrl;
      copy.className = "copy";
      title.textContent = record.title || "标题待检查";
      meta.textContent = `${record.author || "作者未知"} · •${String(record.sourceId || "").slice(-6)}`;
      open.type = "button";
      open.dataset.recordIndex = String(index);
      open.textContent = "打开原帖";
      copy.append(title, meta);
      row.append(image, copy, open);
      elements.libraryList.append(row);
    });
    elements.libraryList.dataset.records = JSON.stringify(records.slice(0, 100).map((record) => ({
      userCorrectedSourceUrl: record.userCorrectedSourceUrl,
      canonicalSourceUrl: record.canonicalSourceUrl,
      rawSourceUrl: record.rawSourceUrl
    })));
  }

  async function openOriginalFromEvent(event) {
    const button = event.target.closest?.("button[data-record-index]");
    if (!button) return;
    const records = JSON.parse(elements.libraryList.dataset.records || "[]");
    const url = resolveOriginalUrl(records[Number(button.dataset.recordIndex)]);
    if (!url) {
      elements.libraryMessage.textContent = "该记录没有可确认的小红书笔记链接；没有跳转到 profile 或其他页面。";
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function resolveOriginalUrl(record) {
    for (const value of [record?.userCorrectedSourceUrl, record?.canonicalSourceUrl, record?.rawSourceUrl]) {
      try {
        const url = new URL(value);
        if (!["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname.toLowerCase())) continue;
        if (!/^\/(?:explore|discovery\/item|search_result)\/[a-zA-Z0-9_-]{6,80}(?:\/|$)/.test(url.pathname)) continue;
        return url.toString();
      } catch {
        // Continue to the next URL source.
      }
    }
    return "";
  }

  function normalizeRecord(item) {
    return {
      sourceId: clean(item?.sourceId),
      rawSourceUrl: clean(item?.rawSourceUrl),
      canonicalSourceUrl: clean(item?.canonicalSourceUrl),
      userCorrectedSourceUrl: clean(item?.userCorrectedSourceUrl),
      title: clean(item?.title),
      author: clean(item?.author),
      coverUrl: clean(item?.coverUrl),
      visibleExcerpt: clean(item?.visibleExcerpt).slice(0, 360),
      capturedAt: clean(item?.capturedAt),
      selectorVersion: clean(item?.selectorVersion)
    };
  }

  function buildDedupeKey(record) {
    if (record.sourceId) return `source:${record.sourceId}`;
    if (record.canonicalSourceUrl) return `url:${record.canonicalSourceUrl}`;
    const fallback = [record.title, record.author, record.visibleExcerpt].join("|");
    return fallback.replace(/\|/g, "") ? `fallback:${stableHash(fallback)}` : "";
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("无法打开 M0 Preview IndexedDB。"));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          const records = database.createObjectStore(RECORD_STORE, { keyPath: "dedupeKey" });
          records.createIndex("sourceId", "sourceId", { unique: false });
          records.createIndex("canonicalSourceUrl", "canonicalSourceUrl", { unique: false });
          records.createIndex("importBatchId", "importBatchId", { unique: false });
          records.createIndex("importedAt", "importedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains(BATCH_STORE)) {
          const batches = database.createObjectStore(BATCH_STORE, { keyPath: "importBatchId" });
          batches.createIndex("scanSessionId", "scanSessionId", { unique: false });
          batches.createIndex("importedAt", "importedAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }

  async function putBatch(batch) {
    const database = await openDatabase();
    const transaction = database.transaction(BATCH_STORE, "readwrite");
    transaction.objectStore(BATCH_STORE).put(batch);
    await transactionDone(transaction);
  }

  async function getBatch(batchId) {
    const database = await openDatabase();
    const transaction = database.transaction(BATCH_STORE, "readonly");
    const batch = await requestResult(transaction.objectStore(BATCH_STORE).get(batchId));
    await transactionDone(transaction);
    return batch || null;
  }

  function requestExtension(type, payload) {
    const requestId = `${type}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("扩展响应超时。请确认已加载 0.3.0-m0-preview 并刷新本页。"));
      }, 8000);
      pendingRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: SOURCE_WEB, type, requestId, ...payload }, window.location.origin);
    });
  }

  function handleExtensionResponse(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data || {};
    if (message.source !== SOURCE_EXTENSION || message.type !== "M0_PREVIEW_RESPONSE") return;
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRequests.delete(message.requestId);
    pending.resolve(message.response);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败。"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 事务已中止。"));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败。"));
    });
  }

  function renderSummary(summary) {
    elements.totalCount.textContent = formatNumber(summary.totalCount);
    elements.newCount.textContent = formatNumber(summary.newCount);
    elements.existingCount.textContent = formatNumber(summary.existingCount);
    elements.reviewCount.textContent = formatNumber(summary.reviewCount);
  }

  function fail(message) {
    elements.connectionBadge.dataset.state = "error";
    elements.connectionBadge.textContent = "连接失败";
    elements.importTitle.textContent = "无法读取导入批次";
    elements.importStatus.textContent = message;
  }

  function isSafeImageUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol); } catch { return false; } }
  function stableHash(value) { let hash = 2166136261; for (const character of String(value || "")) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); }
  function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN"); }
  function maskId(value) { return value ? `••••${String(value).slice(-8)}` : "未知批次"; }
})();
