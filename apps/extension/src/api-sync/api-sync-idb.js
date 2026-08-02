(() => {
  const DB_NAME = "collection-revival-api-sync-v1";
  const DB_VERSION = 1;
  const RUNS = "runs";
  const STAGING_FAVORITES = "stagingFavorites";
  const STAGING_ALBUMS = "stagingAlbums";
  const STAGING_MEMBERSHIPS = "stagingMemberships";
  const LIBRARY_FAVORITES = "libraryFavorites";
  const LIBRARY_ALBUMS = "librarySourceAlbums";
  const LIBRARY_MEMBERSHIPS = "librarySourceAlbumMemberships";
  let databasePromise;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("Cannot open API sync IndexedDB"));
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of [RUNS, STAGING_FAVORITES, STAGING_ALBUMS, STAGING_MEMBERSHIPS, LIBRARY_FAVORITES, LIBRARY_ALBUMS, LIBRARY_MEMBERSHIPS]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }
  function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("IndexedDB request failed")); }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed")); transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted")); }); }
  function id() { return `api_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`; }
  function key(runId, value) { return `${runId}\u0000${value}`; }
  function now() { return new Date().toISOString(); }
  async function readAll(storeName, runId) {
    const db = await openDatabase(); const tx = db.transaction(storeName, "readonly"); const rows = await requestResult(tx.objectStore(storeName).getAll()); await transactionDone(tx);
    return rows.filter((row) => row.runId === runId).map((row) => row.value);
  }
  async function getLibrarySnapshot() {
    const db = await openDatabase(); const tx = db.transaction([LIBRARY_FAVORITES, LIBRARY_ALBUMS, LIBRARY_MEMBERSHIPS], "readonly");
    const [favorites, albums, memberships] = await Promise.all([requestResult(tx.objectStore(LIBRARY_FAVORITES).getAll()), requestResult(tx.objectStore(LIBRARY_ALBUMS).getAll()), requestResult(tx.objectStore(LIBRARY_MEMBERSHIPS).getAll())]); await transactionDone(tx);
    return { favorites: new Map(favorites.map((row) => [row.value.sourceId, row.value])), albums: new Map(albums.map((row) => [row.value.sourceAlbumId, row.value])), memberships: new Map(memberships.map((row) => [`${row.value.sourceId}\u0000${row.value.sourceAlbumId}`, row.value])) };
  }
  async function createRun() {
    const db = await openDatabase(); const run = { runId: id(), status: "ready", createdAt: now(), updatedAt: now(), progress: { favoriteCount: 0, albumCount: 0, membershipCount: 0, pageCount: 0, hasMore: true, elapsedMs: 0 }, summary: null, checkpoint: null };
    const tx = db.transaction(RUNS, "readwrite"); tx.objectStore(RUNS).put({ key: run.runId, ...run }); await transactionDone(tx); return run;
  }
  async function getRun(runId) { const db = await openDatabase(); const tx = db.transaction(RUNS, "readonly"); const row = await requestResult(tx.objectStore(RUNS).get(runId)); await transactionDone(tx); return row ? withoutKey(row) : null; }
  async function updateRun(runId, patch) { const db = await openDatabase(); const tx = db.transaction(RUNS, "readwrite"); const store = tx.objectStore(RUNS); const row = await requestResult(store.get(runId)); if (!row) throw new Error("API sync run not found"); const next = { ...row, ...patch, updatedAt: now() }; store.put(next); await transactionDone(tx); return withoutKey(next); }
  async function stageSnapshot(runId, snapshot, progress, checkpoint) {
    const db = await openDatabase(); const tx = db.transaction([RUNS, STAGING_FAVORITES, STAGING_ALBUMS, STAGING_MEMBERSHIPS], "readwrite");
    const stores = [STAGING_FAVORITES, STAGING_ALBUMS, STAGING_MEMBERSHIPS].map((name) => tx.objectStore(name));
    for (const store of stores) { const rows = await requestResult(store.getAll()); rows.filter((row) => row.runId === runId).forEach((row) => store.delete(row.key)); }
    for (const value of snapshot.favorites.values()) stores[0].put({ key: key(runId, value.sourceId), runId, value });
    for (const value of snapshot.albums.values()) stores[1].put({ key: key(runId, value.sourceAlbumId), runId, value });
    for (const value of snapshot.memberships.values()) stores[2].put({ key: key(runId, `${value.sourceId}\u0000${value.sourceAlbumId}`), runId, value });
    const runStore = tx.objectStore(RUNS); const row = await requestResult(runStore.get(runId)); if (!row) throw new Error("API sync run not found"); runStore.put({ ...row, status: "reading", progress, checkpoint, updatedAt: now() }); await transactionDone(tx);
  }
  async function verifyRun(runId) {
    const [run, favorites, albums, memberships, previous] = await Promise.all([getRun(runId), readAll(STAGING_FAVORITES, runId), readAll(STAGING_ALBUMS, runId), readAll(STAGING_MEMBERSHIPS, runId), getLibrarySnapshot()]);
    if (!run) throw new Error("API sync run not found"); const snapshot = { favorites: new Map(favorites.map((x) => [x.sourceId, x])), albums: new Map(albums.map((x) => [x.sourceAlbumId, x])), memberships: new Map(memberships.map((x) => [`${x.sourceId}\u0000${x.sourceAlbumId}`, x])) };
    const verification = CollectionRevivalApiSyncCore.verifySnapshot(snapshot); if (!verification.ok) return updateRun(runId, { status: "failed", summary: verification });
    const summary = { ...verification, ...CollectionRevivalApiSyncCore.diffSnapshots(previous, snapshot), invalidCount: run.progress?.invalidCount || 0 };
    return updateRun(runId, { status: "awaiting_confirmation", summary });
  }
  async function confirmImport(runId) {
    const run = await getRun(runId); if (!run || run.status !== "awaiting_confirmation") throw new Error("Snapshot is not ready for import");
    const [favorites, albums, memberships] = await Promise.all([readAll(STAGING_FAVORITES, runId), readAll(STAGING_ALBUMS, runId), readAll(STAGING_MEMBERSHIPS, runId)]);
    const db = await openDatabase(); const tx = db.transaction([LIBRARY_FAVORITES, LIBRARY_ALBUMS, LIBRARY_MEMBERSHIPS, RUNS], "readwrite");
    for (const name of [LIBRARY_FAVORITES, LIBRARY_ALBUMS, LIBRARY_MEMBERSHIPS]) { const store = tx.objectStore(name); const rows = await requestResult(store.getAll()); rows.forEach((row) => store.delete(row.key)); }
    favorites.forEach((value) => tx.objectStore(LIBRARY_FAVORITES).put({ key: value.sourceId, value }));
    albums.forEach((value) => tx.objectStore(LIBRARY_ALBUMS).put({ key: value.sourceAlbumId, value }));
    memberships.forEach((value) => tx.objectStore(LIBRARY_MEMBERSHIPS).put({ key: `${value.sourceId}\u0000${value.sourceAlbumId}`, value }));
    const runs = tx.objectStore(RUNS); const row = await requestResult(runs.get(runId)); runs.put({ ...row, status: "imported", importedAt: now(), updatedAt: now() }); await transactionDone(tx); return getRun(runId);
  }
  async function discardRun(runId) {
    const db = await openDatabase(); const tx = db.transaction([RUNS, STAGING_FAVORITES, STAGING_ALBUMS, STAGING_MEMBERSHIPS], "readwrite");
    for (const name of [STAGING_FAVORITES, STAGING_ALBUMS, STAGING_MEMBERSHIPS]) { const store = tx.objectStore(name); const rows = await requestResult(store.getAll()); rows.filter((row) => row.runId === runId).forEach((row) => store.delete(row.key)); }
    const store = tx.objectStore(RUNS); const row = await requestResult(store.get(runId)); if (row) store.put({ ...row, status: "discarded", updatedAt: now() }); await transactionDone(tx); return getRun(runId);
  }
  function withoutKey(row) { const { key: _key, ...run } = row; return run; }
  globalThis.CollectionRevivalApiSyncDb = { createRun, getRun, updateRun, stageSnapshot, verifyRun, confirmImport, discardRun, getLibrarySnapshot, DB_NAME };
})();
