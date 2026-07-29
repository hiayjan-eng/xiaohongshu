(() => {
  const DB_NAME = "collection-revival-m0-full-scan-spike";
  const DB_VERSION = 1;
  const SESSION_STORE = "scanSessions";
  const ITEM_STORE = "favoriteItems";
  const SESSION_ITEM_STORE = "scanSessionItems";
  const RECENT_LIMIT = 12;

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
      importBatchId: createId("import"),
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
      newItemCount: 0,
      duplicateInsertCount: 0,
      lastSourceId: "",
      lastScrollTop: 0,
      lastScrollHeight: 0,
      stableNoGrowthCycles: 0,
      retryCount: 0,
      selectorVersion: identity.selectorVersion || "m0-full-scan-spike-v1",
      extensionVersion: identity.extensionVersion || "0.2.3-spike",
      itemsCheckpoint: 0,
      lastErrorCode: "",
      lastErrorMessage: "",
      ...overrides
    };
  }

  async function createSession(identity, options = {}) {
    assertIdentity(identity);
    if (options.resume !== false) {
      const existing = await findLatestSession(identity.favoritesPageIdentity);
      if (existing && !["completed", "stopped"].includes(existing.status)) return existing;
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

    const recentItems = [];
    for (const rawItem of items.slice(0, 100)) {
      const item = normalizeItem(rawItem, session);
      const dedupeKey = dedupeKeyFor(item);
      if (!dedupeKey || !item.sourceId || !item.canonicalSourceUrl) {
        const invalidRelationKey = `${sessionId}|invalid:${stableHash(JSON.stringify(rawItem || {}))}`;
        const existingInvalid = await requestResult(sessionItemStore.get(invalidRelationKey));
        if (!existingInvalid) {
          sessionItemStore.put({
            sessionItemKey: invalidRelationKey,
            sessionId,
            sourceId: "",
            dedupeKey: "",
            valid: false,
            capturedAt: item.capturedAt
          });
          session.discoveredCount += 1;
          session.invalidCount += 1;
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

  async function resetSession(identity) {
    assertIdentity(identity);
    const existing = await findLatestSession(identity.favoritesPageIdentity);
    if (existing && !["completed", "stopped"].includes(existing.status)) {
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
      case "M0_FULL_SCAN_RESET_SESSION":
        return { ok: true, session: await resetSession(message.identity) };
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
      "itemsCheckpoint",
      "lastErrorCode",
      "lastErrorMessage"
    ];
    return Object.fromEntries(allowed.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
  }

  function assertIdentity(identity) {
    if (!identity?.profileIdHash || !identity?.favoritesPageIdentity) {
      throw new Error("缺少脱敏账号或收藏页身份，不能创建扫描会话。");
    }
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
    getSession,
    handleMessage,
    listRecentItems,
    openDatabase,
    persistItems,
    resetSession,
    updateSession,
    verifySession
  };
})();
