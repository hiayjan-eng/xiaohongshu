(() => {
  const DB_NAME = "collection-revival-m0-preview-v1";
  const DB_VERSION = 2;
  const SESSION_STORE = "scanSessions";
  const ITEM_STORE = "favoriteItems";
  const SESSION_ITEM_STORE = "scanSessionItems";
  const IMPORT_STORE = "importBatches";
  const RECENT_LIMIT = 12;
  const IMPORT_CHUNK_LIMIT = 200;

  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("无法打开全量扫描 IndexedDB。"));
      request.onblocked = () => reject(new Error("全量扫描 IndexedDB 升级被其他页面阻塞。"));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
          sessions.createIndex("favoritesPageIdentity", "favoritesPageIdentity", { unique: false });
          sessions.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains(ITEM_STORE)) {
          const items = database.createObjectStore(ITEM_STORE, { keyPath: "storageKey" });
          items.createIndex("sourceId", "sourceId", { unique: false });
          items.createIndex("favoritesPageIdentity", "favoritesPageIdentity", { unique: false });
          items.createIndex("capturedAt", "capturedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains(SESSION_ITEM_STORE)) {
          const sessionItems = database.createObjectStore(SESSION_ITEM_STORE, { keyPath: "sessionItemKey" });
          sessionItems.createIndex("sessionId", "sessionId", { unique: false });
          sessionItems.createIndex("sessionAndSourceId", ["sessionId", "sourceId"], { unique: false });
        }
        if (!database.objectStoreNames.contains(IMPORT_STORE)) {
          const imports = database.createObjectStore(IMPORT_STORE, { keyPath: "importBatchId" });
          imports.createIndex("scanSessionId", "scanSessionId", { unique: false });
          imports.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
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

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `${prefix}_${uuid}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptySession(identity, overrides = {}) {
    const timestamp = nowIso();
    return {
      sessionId: createId("scan"),
      importBatchId: "",
      profileIdHash: identity.profileIdHash,
      favoritesPageIdentity: identity.favoritesPageIdentity,
      status: "ready",
      startedAt: timestamp,
      updatedAt: timestamp,
      discoveredCount: 0,
      validCount: 0,
      duplicateCount: 0,
      existingCount: 0,
      invalidCount: 0,
      missingLinkCount: 0,
      reviewCount: 0,
      newItemCount: 0,
      duplicateInsertCount: 0,
      lastSourceId: "",
      lastScrollTop: 0,
      lastScrollHeight: 0,
      stableNoGrowthCycles: 0,
      retryCount: 0,
      resumeCount: 0,
      completedAt: "",
      selectorVersion: identity.selectorVersion || "m0-real-favorites-v3",
      extensionVersion: identity.extensionVersion || "0.3.0-m0-preview",
      itemsCheckpoint: 0,
      lastErrorCode: "",
      lastErrorMessage: "",
      contaminatedAt: "",
      contaminationCode: "",
      discardedAt: "",
      discardedItemCount: 0,
      preservedExistingItemCount: 0,
      ...overrides
    };
  }

  async function createSession(identity, options = {}) {
    assertIdentity(identity);
    const latest = await findLatestSession(identity.favoritesPageIdentity);
    if (isUnsafeBoundarySession(latest)) {
      return invalidateSession(latest.sessionId, "UNSAFE_0_3_3_ROOT_BOUNDARY", "0.3.3 扫描会话使用了无法证明活动收藏面板归属的 root，已自动标记为 contaminated。必须丢弃后重新扫描。");
    }
    if (latest?.status === "contaminated") {
      throw new Error("当前会话已 contaminated，必须先精确丢弃本轮错误记录，不能继续或新建扫描。");
    }
    if (options.resume !== false) {
      if (latest && !["completed", "discarded"].includes(latest.status)) return latest;
    }
    const database = await openDatabase();
    const session = emptySession(identity);
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).add(session);
    await transactionDone(transaction);
    return session;
  }

  async function findLatestSession(favoritesPageIdentity) {
    if (!favoritesPageIdentity) return null;
    const database = await openDatabase();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const index = transaction.objectStore(SESSION_STORE).index("favoritesPageIdentity");
    const sessions = await requestResult(index.getAll(IDBKeyRange.only(favoritesPageIdentity)));
    await transactionDone(transaction);
    return sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null;
  }

  async function getSession(sessionId) {
    if (!sessionId) return null;
    const database = await openDatabase();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const session = await requestResult(transaction.objectStore(SESSION_STORE).get(sessionId));
    await transactionDone(transaction);
    return session || null;
  }

  async function updateSession(sessionId, patch = {}) {
    const database = await openDatabase();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    const store = transaction.objectStore(SESSION_STORE);
    const session = await requestResult(store.get(sessionId));
    if (!session) {
      transaction.abort();
      throw new Error("找不到可更新的全量扫描会话。");
    }
    if (["contaminated", "discarded"].includes(session.status) && patch.status && patch.status !== session.status) {
      transaction.abort();
      throw new Error("已隔离或已丢弃的扫描会话禁止恢复为其他状态。");
    }
    const next = {
      ...session,
      ...pickSessionPatch(patch),
      sessionId: session.sessionId,
      profileIdHash: session.profileIdHash,
      favoritesPageIdentity: session.favoritesPageIdentity,
      updatedAt: nowIso()
    };
    store.put(next);
    await transactionDone(transaction);
    return next;
  }

  async function persistItems(sessionId, items = [], checkpoint = {}) {
    const database = await openDatabase();
    const transaction = database.transaction([SESSION_STORE, ITEM_STORE, SESSION_ITEM_STORE], "readwrite");
    const sessions = transaction.objectStore(SESSION_STORE);
    const itemStore = transaction.objectStore(ITEM_STORE);
    const sessionItemStore = transaction.objectStore(SESSION_ITEM_STORE);
    const session = await requestResult(sessions.get(sessionId));
    if (!session) {
      transaction.abort();
      throw new Error("找不到接收流式收藏的扫描会话。");
    }
    if (session.status !== "scanning") {
      transaction.abort();
      throw new Error("当前扫描会话不是 scanning 状态，禁止继续写入收藏。");
    }

    const recentItems = [];
    for (const rawItem of items.slice(0, 100)) {
      const item = normalizeItem(rawItem, session);
      const dedupeKey = dedupeKeyFor(item);
      if (!dedupeKey || !item.sourceId || !item.canonicalSourceUrl || !item.title) {
        const invalidRelationKey = `${sessionId}|invalid:${stableHash(JSON.stringify(rawItem || {}))}`;
        const existingInvalid = await requestResult(sessionItemStore.get(invalidRelationKey));
        if (!existingInvalid) {
          sessionItemStore.put({
            sessionItemKey: invalidRelationKey,
            sessionId,
            sourceId: "",
            dedupeKey: "",
            valid: false,
            reviewReason: !item.sourceId ? "MISSING_SOURCE_ID" : !item.canonicalSourceUrl ? "MISSING_SOURCE_URL" : "MISSING_TITLE",
            capturedAt: item.capturedAt
          });
          session.discoveredCount += 1;
          session.invalidCount += 1;
          session.reviewCount += 1;
          if (!item.sourceId || !item.canonicalSourceUrl) session.missingLinkCount += 1;
        } else {
          session.duplicateCount += 1;
        }
        continue;
      }

      const storageKey = `${session.favoritesPageIdentity}|${dedupeKey}`;
      const sessionItemKey = `${sessionId}|${dedupeKey}`;
      const existingRelation = await requestResult(sessionItemStore.get(sessionItemKey));
      if (existingRelation) {
        session.duplicateCount += 1;
        continue;
      }

      const existingItem = await requestResult(itemStore.get(storageKey));
      sessionItemStore.put({
        sessionItemKey,
        sessionId,
        sourceId: item.sourceId,
        dedupeKey,
        storageKey,
        valid: true,
        capturedAt: item.capturedAt
      });
      session.discoveredCount += 1;
      session.validCount += 1;
      if (existingItem) {
        session.existingCount += 1;
        itemStore.put({
          ...existingItem,
          ...item,
          storageKey,
          firstScanSessionId: existingItem.firstScanSessionId,
          lastScanSessionId: sessionId,
          lastSeenAt: item.capturedAt
        });
      } else {
        session.newItemCount += 1;
        itemStore.add({
          ...item,
          storageKey,
          firstScanSessionId: sessionId,
          lastScanSessionId: sessionId,
          lastSeenAt: item.capturedAt
        });
      }
      session.lastSourceId = item.sourceId;
      session.itemsCheckpoint = session.discoveredCount;
      recentItems.push(item);
    }

    Object.assign(session, pickSessionPatch(checkpoint), { updatedAt: nowIso() });
    sessions.put(session);
    await transactionDone(transaction);
    return {
      session,
      recentItems: recentItems.slice(-RECENT_LIMIT),
      maxTransactionItemCount: Math.min(items.length, 100)
    };
  }

  async function listRecentItems(sessionId, limit = RECENT_LIMIT) {
    const database = await openDatabase();
    const transaction = database.transaction([ITEM_STORE, SESSION_ITEM_STORE], "readonly");
    const relations = await requestResult(
      transaction.objectStore(SESSION_ITEM_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId))
    );
    const items = [];
    for (const relation of relations.slice(-Math.max(1, Math.min(limit, RECENT_LIMIT)))) {
      if (!relation.storageKey) continue;
      const item = await requestResult(transaction.objectStore(ITEM_STORE).get(relation.storageKey));
      if (item) items.push(item);
    }
    await transactionDone(transaction);
    return items.slice(-RECENT_LIMIT);
  }

  async function listSessionItems(sessionId, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, IMPORT_CHUNK_LIMIT));
    const offset = Math.max(0, Number(options.offset) || 0);
    const query = clean(options.query).toLowerCase();
    const database = await openDatabase();
    const transaction = database.transaction([ITEM_STORE, SESSION_ITEM_STORE], "readonly");
    let relations = await requestResult(
      transaction.objectStore(SESSION_ITEM_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId))
    );
    relations = relations.filter((relation) => relation.valid && relation.storageKey);
    if (options.random === true) {
      relations.sort((left, right) => stableHash(`${sessionId}|${left.sessionItemKey}`).localeCompare(stableHash(`${sessionId}|${right.sessionItemKey}`)));
    }
    const items = [];
    let matched = 0;
    for (const relation of relations) {
      const item = await requestResult(transaction.objectStore(ITEM_STORE).get(relation.storageKey));
      if (!item) continue;
      if (query && ![item.title, item.author, item.visibleExcerpt, item.sourceId].some((value) => clean(value).toLowerCase().includes(query))) continue;
      if (matched >= offset && items.length < limit) items.push(item);
      matched += 1;
      if (items.length >= limit && options.random !== true) break;
    }
    await transactionDone(transaction);
    return {
      items,
      offset,
      limit,
      totalMatched: query || options.random === true ? matched : relations.length,
      hasMore: offset + items.length < (query || options.random === true ? matched : relations.length)
    };
  }

  async function prepareImportBatch(sessionId, origin, extensionVersion) {
    const session = await getSession(sessionId);
    if (!session || session.status !== "completed") throw new Error("只有完成并通过核验的扫描才能导入 Preview。");
    const database = await openDatabase();
    const importBatch = {
      importBatchId: createId("import"),
      scanSessionId: session.sessionId,
      extensionVersion: clean(extensionVersion || session.extensionVersion || "0.3.0-m0-preview"),
      targetOrigin: clean(origin),
      status: "prepared",
      totalCount: session.validCount,
      reviewCount: session.invalidCount,
      createdAt: nowIso(),
      importedAt: "",
      result: null
    };
    const transaction = database.transaction(IMPORT_STORE, "readwrite");
    transaction.objectStore(IMPORT_STORE).add(importBatch);
    await transactionDone(transaction);
    return importBatch;
  }

  async function getImportBatch(importBatchId) {
    const database = await openDatabase();
    const transaction = database.transaction(IMPORT_STORE, "readonly");
    const batch = await requestResult(transaction.objectStore(IMPORT_STORE).get(importBatchId));
    await transactionDone(transaction);
    return batch || null;
  }

  async function getImportMeta(importBatchId) {
    const batch = await getImportBatch(importBatchId);
    if (!batch) throw new Error("找不到待导入批次。");
    const session = await getSession(batch.scanSessionId);
    if (!session) throw new Error("找不到导入批次对应的扫描会话。");
    return {
      importBatchId: batch.importBatchId,
      scanSessionId: batch.scanSessionId,
      extensionVersion: batch.extensionVersion,
      createdAt: batch.createdAt,
      totalCount: session.validCount,
      reviewCount: session.invalidCount,
      selectorVersion: session.selectorVersion,
      status: batch.status
    };
  }

  async function getImportChunk(importBatchId, offset = 0, limit = IMPORT_CHUNK_LIMIT) {
    const batch = await getImportBatch(importBatchId);
    if (!batch) throw new Error("找不到待导入批次。");
    const result = await listSessionItems(batch.scanSessionId, { offset, limit });
    return {
      importBatchId,
      scanSessionId: batch.scanSessionId,
      extensionVersion: batch.extensionVersion,
      items: result.items,
      offset: result.offset,
      nextOffset: result.offset + result.items.length,
      hasMore: result.hasMore,
      totalCount: result.totalMatched
    };
  }

  async function recordImportResult(importBatchId, result = {}) {
    const database = await openDatabase();
    const transaction = database.transaction(IMPORT_STORE, "readwrite");
    const store = transaction.objectStore(IMPORT_STORE);
    const batch = await requestResult(store.get(importBatchId));
    if (!batch) {
      transaction.abort();
      throw new Error("找不到待更新的导入批次。");
    }
    const next = {
      ...batch,
      status: result.status === "rolled_back" ? "rolled_back" : "imported",
      importedAt: clean(result.importedAt || nowIso()),
      result: {
        importedCount: Math.max(0, Number(result.importedCount) || 0),
        existingCount: Math.max(0, Number(result.existingCount) || 0),
        reviewCount: Math.max(0, Number(result.reviewCount) || 0)
      }
    };
    store.put(next);
    await transactionDone(transaction);
    return next;
  }
  async function verifySession(sessionId) {
    const database = await openDatabase();
    const transaction = database.transaction([SESSION_STORE, SESSION_ITEM_STORE], "readonly");
    const session = await requestResult(transaction.objectStore(SESSION_STORE).get(sessionId));
    if (!session) {
      transaction.abort();
      throw new Error("找不到待核验的扫描会话。");
    }
    const relations = await requestResult(
      transaction.objectStore(SESSION_ITEM_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId))
    );
    await transactionDone(transaction);
    const validRelations = relations.filter((relation) => relation.valid);
    const uniqueSourceIds = new Set(validRelations.map((relation) => relation.sourceId).filter(Boolean));
    return {
      sessionId,
      relationCount: relations.length,
      validRelationCount: validRelations.length,
      uniqueSourceIdCount: uniqueSourceIds.size,
      duplicateInsertCount: session.duplicateInsertCount,
      consistent:
        validRelations.length === session.validCount &&
        uniqueSourceIds.size === session.validCount &&
        session.duplicateInsertCount === 0
    };
  }

  async function getDiagnostics(sessionId) {
    const session = await getSession(sessionId);
    if (!session) return null;
    const verification = await verifySession(sessionId);
    return {
      session,
      verification,
      recentItems: await listRecentItems(sessionId)
    };
  }

  async function invalidateSession(sessionId, code = "FAVORITES_BOUNDARY_INVALID", reason = "收藏面板边界无法继续证明，本轮会话已标记为 contaminated。") {
    const session = await getSession(sessionId);
    if (!session) throw new Error("找不到待隔离的扫描会话。");
    if (session.status === "discarded") throw new Error("该错误会话已经丢弃。");
    if (session.status === "completed") throw new Error("已完成会话不能在此处改为 contaminated。");
    if (session.status === "contaminated") return session;
    return updateSession(sessionId, {
      status: "contaminated",
      lastErrorCode: code,
      lastErrorMessage: reason,
      contaminatedAt: nowIso(),
      contaminationCode: code
    });
  }

  async function discardContaminatedSession(sessionId, favoritesPageIdentity) {
    const database = await openDatabase();
    const transaction = database.transaction([SESSION_STORE, ITEM_STORE, SESSION_ITEM_STORE, IMPORT_STORE], "readwrite");
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const itemStore = transaction.objectStore(ITEM_STORE);
    const relationStore = transaction.objectStore(SESSION_ITEM_STORE);
    const importStore = transaction.objectStore(IMPORT_STORE);
    const session = await requestResult(sessionStore.get(sessionId));
    if (!session || session.favoritesPageIdentity !== favoritesPageIdentity) {
      transaction.abort();
      throw new Error("错误会话与当前收藏页身份不一致，未执行丢弃。");
    }
    if (session.status !== "contaminated") {
      transaction.abort();
      throw new Error("只有已标记 contaminated 的会话可以精确丢弃。");
    }
    const importBatches = await requestResult(importStore.index("scanSessionId").getAll(IDBKeyRange.only(sessionId)));
    if (importBatches.some((batch) => batch.status === "imported")) {
      transaction.abort();
      throw new Error("该会话已有已导入批次，禁止自动删除。");
    }
    for (const batch of importBatches) importStore.delete(batch.importBatchId);

    const relations = await requestResult(relationStore.index("sessionId").getAll(IDBKeyRange.only(sessionId)));
    const allRelations = await requestResult(relationStore.getAll());
    const storageKeysUsedByOtherSessions = new Set(
      allRelations
        .filter((relation) => relation.sessionId !== sessionId && relation.valid && relation.storageKey)
        .map((relation) => relation.storageKey)
    );
    let deletedItemCount = 0;
    let preservedExistingItemCount = 0;
    for (const relation of relations) {
      if (relation.storageKey) {
        const item = await requestResult(itemStore.get(relation.storageKey));
        const createdOnlyByContaminatedSession = item?.firstScanSessionId === sessionId && !storageKeysUsedByOtherSessions.has(relation.storageKey);
        if (createdOnlyByContaminatedSession) {
          itemStore.delete(relation.storageKey);
          deletedItemCount += 1;
        } else if (item) {
          preservedExistingItemCount += 1;
        }
      }
      relationStore.delete(relation.sessionItemKey);
    }
    const discardedAt = nowIso();
    const discarded = {
      ...session,
      status: "discarded",
      discardedAt,
      updatedAt: discardedAt,
      discardedItemCount: deletedItemCount,
      preservedExistingItemCount,
      discoveredCount: 0,
      validCount: 0,
      invalidCount: 0,
      missingLinkCount: 0,
      reviewCount: 0,
      newItemCount: 0,
      existingCount: 0,
      duplicateCount: 0,
      duplicateInsertCount: 0,
      itemsCheckpoint: 0,
      lastSourceId: "",
      lastErrorCode: "CONTAMINATED_SESSION_DISCARDED",
      lastErrorMessage: `已精确丢弃本轮错误会话的 ${deletedItemCount} 条新记录；既有记录与 Preview 数据未处理。`
    };
    sessionStore.put(discarded);
    await transactionDone(transaction);
    return { session: discarded, deletedItemCount, preservedExistingItemCount };
  }

  async function resetSession(identity) {
    assertIdentity(identity);
    const existing = await findLatestSession(identity.favoritesPageIdentity);
    if (existing?.status === "contaminated") throw new Error("当前会话已 contaminated，请先使用“丢弃本轮错误会话并重新扫描”。");
    if (existing && !["completed", "stopped", "discarded"].includes(existing.status)) {
      await updateSession(existing.sessionId, { status: "stopped" });
    }
    return createSession(identity, { resume: false });
  }

  async function clearDatabaseForTests() {
    if (databasePromise) {
      const database = await databasePromise;
      database.close();
      databasePromise = null;
    }
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("无法清理测试数据库。"));
      request.onblocked = () => reject(new Error("测试数据库仍被占用。"));
    });
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case "M0_FULL_SCAN_CREATE_SESSION":
        return { ok: true, session: await createSession(message.identity, { resume: message.resume !== false }) };
      case "M0_FULL_SCAN_GET_SESSION": {
        const session = message.sessionId
          ? await getSession(message.sessionId)
          : await findLatestSession(message.favoritesPageIdentity);
        return {
          ok: true,
          session,
          recentItems: session ? await listRecentItems(session.sessionId) : []
        };
      }
      case "M0_FULL_SCAN_UPDATE_SESSION":
        return { ok: true, session: await updateSession(message.sessionId, message.patch) };
      case "M0_FULL_SCAN_PERSIST_ITEMS":
        return { ok: true, ...(await persistItems(message.sessionId, message.items, message.checkpoint)) };
      case "M0_FULL_SCAN_VERIFY_SESSION":
        return { ok: true, verification: await verifySession(message.sessionId) };
      case "M0_FULL_SCAN_GET_DIAGNOSTICS":
        return { ok: true, diagnostics: await getDiagnostics(message.sessionId) };
      case "M0_FULL_SCAN_LIST_ITEMS":
        return { ok: true, ...(await listSessionItems(message.sessionId, message.options)) };
      case "M0_FULL_SCAN_INVALIDATE_SESSION":
        return { ok: true, session: await invalidateSession(message.sessionId, message.code, message.reason) };
      case "M0_FULL_SCAN_DISCARD_CONTAMINATED_SESSION":
        return { ok: true, ...(await discardContaminatedSession(message.sessionId, message.favoritesPageIdentity)) };
      case "M0_FULL_SCAN_RESET_SESSION":
        return { ok: true, session: await resetSession(message.identity) };
      case "M0_PREVIEW_PREPARE_IMPORT":
        return { ok: true, importBatch: await prepareImportBatch(message.sessionId, message.origin, message.extensionVersion) };
      case "M0_PREVIEW_IMPORT_META_REQUEST":
        return { ok: true, meta: await getImportMeta(message.importBatchId) };
      case "M0_PREVIEW_IMPORT_CHUNK_REQUEST":
        return { ok: true, chunk: await getImportChunk(message.importBatchId, message.offset, message.limit) };
      case "M0_PREVIEW_IMPORT_RESULT":
        return { ok: true, importBatch: await recordImportResult(message.importBatchId, message.result) };
      default:
        return null;
    }
  }

  function normalizeItem(item, session) {
    const capturedAt = item?.capturedAt || nowIso();
    return {
      sourceId: clean(item?.sourceId),
      rawSourceUrl: clean(item?.rawSourceUrl),
      canonicalSourceUrl: clean(item?.canonicalSourceUrl),
      title: clean(item?.title),
      author: clean(item?.author),
      coverUrl: clean(item?.coverUrl),
      visibleExcerpt: clean(item?.visibleExcerpt).slice(0, 360),
      capturedAt,
      scanSessionId: session.sessionId,
      favoritesPageIdentity: session.favoritesPageIdentity,
      selectorVersion: item?.selectorVersion || session.selectorVersion
    };
  }

  function dedupeKeyFor(item) {
    if (item.sourceId) return `source:${item.sourceId}`;
    if (item.canonicalSourceUrl) return `url:${item.canonicalSourceUrl}`;
    const fallback = [item.title, item.author, item.visibleExcerpt].join("|");
    return fallback.replace(/\|/g, "") ? `fallback:${stableHash(fallback)}` : "";
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < String(value).length; index += 1) {
      hash ^= String(value).charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function pickSessionPatch(patch) {
    const allowed = [
      "status",
      "lastScrollTop",
      "lastScrollHeight",
      "stableNoGrowthCycles",
      "retryCount",
      "resumeCount",
      "completedAt",
      "itemsCheckpoint",
      "lastErrorCode",
      "lastErrorMessage",
      "contaminatedAt",
      "contaminationCode"
    ];
    return Object.fromEntries(allowed.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
  }

  function assertIdentity(identity) {
    if (!identity?.profileIdHash || !identity?.favoritesPageIdentity) {
      throw new Error("缺少脱敏账号或收藏页身份，不能创建扫描会话。");
    }
  }

  function isUnsafeBoundarySession(session) {
    return Boolean(
      session &&
      session.extensionVersion === "0.3.3-m0-preview" &&
      Number(session.validCount) > 0 &&
      !["completed", "contaminated", "discarded"].includes(session.status)
    );
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  globalThis.CollectionRevivalFullScanDb = {
    DB_NAME,
    DB_VERSION,
    RECENT_LIMIT,
    clearDatabaseForTests,
    createSession,
    dedupeKeyFor,
    findLatestSession,
    getDiagnostics,
    getImportBatch,
    getImportChunk,
    getImportMeta,
    getSession,
    handleMessage,
    invalidateSession,
    discardContaminatedSession,
    listRecentItems,
    listSessionItems,
    openDatabase,
    prepareImportBatch,
    persistItems,
    recordImportResult,
    resetSession,
    updateSession,
    verifySession
  };
})();
