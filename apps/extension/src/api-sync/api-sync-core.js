(() => {
  const SOURCE_TYPES = Object.freeze({ ORIGINAL: "xhs-source-album", LOCAL: "local-revival-album", SMART: "smart-album" });

  function createSnapshot() {
    return { favorites: new Map(), albums: new Map(), memberships: new Map() };
  }

  function normalizeFavorite(value) {
    const sourceId = String(value?.sourceId || value?.noteId || "").trim();
    if (!sourceId) return null;
    const originalUrl = String(value?.originalUrl || value?.url || "").trim();
    if (!/^https:\/\/(www\.)?xiaohongshu\.com\/(explore|discovery\/item)\//.test(originalUrl)) return null;
    return {
      sourceId,
      title: String(value?.title || "").slice(0, 300),
      author: String(value?.author || "").slice(0, 160),
      excerpt: String(value?.excerpt || "").slice(0, 360),
      coverUrl: String(value?.coverUrl || ""),
      originalUrl,
      collectedAt: String(value?.collectedAt || "")
    };
  }

  function normalizeAlbum(value, order) {
    const sourceAlbumId = String(value?.sourceAlbumId || value?.albumId || "").trim();
    if (!sourceAlbumId) return null;
    return {
      sourceAlbumId,
      sourceName: String(value?.sourceName || value?.name || "").slice(0, 160),
      coverUrl: String(value?.coverUrl || ""),
      sourceOrder: Number.isFinite(value?.sourceOrder) ? value.sourceOrder : order,
      visibility: String(value?.visibility || "unknown"),
      albumType: SOURCE_TYPES.ORIGINAL
    };
  }

  function addPage(snapshot, kind, page) {
    let invalidCount = 0;
    let duplicateCount = 0;
    if (kind === "favorites") {
      for (const raw of page?.items || []) {
        const item = normalizeFavorite(raw);
        if (!item) { invalidCount += 1; continue; }
        if (snapshot.favorites.has(item.sourceId)) { duplicateCount += 1; continue; }
        snapshot.favorites.set(item.sourceId, item);
      }
    } else if (kind === "albums") {
      for (const raw of page?.items || []) {
        const item = normalizeAlbum(raw, snapshot.albums.size);
        if (!item) { invalidCount += 1; continue; }
        if (snapshot.albums.has(item.sourceAlbumId)) { duplicateCount += 1; continue; }
        snapshot.albums.set(item.sourceAlbumId, item);
      }
    } else if (kind === "memberships") {
      for (const raw of page?.items || []) {
        const sourceId = String(raw?.sourceId || raw?.noteId || "").trim();
        const sourceAlbumId = String(raw?.sourceAlbumId || raw?.albumId || "").trim();
        if (!sourceId || !sourceAlbumId) { invalidCount += 1; continue; }
        const key = `${sourceId}\u0000${sourceAlbumId}`;
        if (snapshot.memberships.has(key)) { duplicateCount += 1; continue; }
        snapshot.memberships.set(key, { sourceId, sourceAlbumId });
      }
    }
    return { invalidCount, duplicateCount };
  }

  function verifySnapshot(snapshot) {
    const invalidMemberships = [];
    for (const membership of snapshot.memberships.values()) {
      if (!snapshot.favorites.has(membership.sourceId) || !snapshot.albums.has(membership.sourceAlbumId)) invalidMemberships.push(membership);
    }
    if (invalidMemberships.length) return { ok: false, code: "INVALID_SOURCE_ALBUM_MEMBERSHIP", invalidMembershipCount: invalidMemberships.length };
    return { ok: true, favoriteCount: snapshot.favorites.size, albumCount: snapshot.albums.size, membershipCount: snapshot.memberships.size };
  }

  function diffSnapshots(previous, next) {
    const oldFavorites = previous?.favorites || new Map();
    const oldMemberships = previous?.memberships || new Map();
    let addedCount = 0;
    let deletedCount = 0;
    for (const id of next.favorites.keys()) if (!oldFavorites.has(id)) addedCount += 1;
    for (const id of oldFavorites.keys()) if (!next.favorites.has(id)) deletedCount += 1;
    const affected = new Set();
    for (const key of next.memberships.keys()) {
      const sourceId = key.split("\u0000")[0];
      if (!oldMemberships.has(key) && oldFavorites.has(sourceId)) affected.add(sourceId);
    }
    for (const key of oldMemberships.keys()) {
      const sourceId = key.split("\u0000")[0];
      if (!next.memberships.has(key) && next.favorites.has(sourceId)) affected.add(sourceId);
    }
    let existingCount = 0;
    for (const id of next.favorites.keys()) if (oldFavorites.has(id)) existingCount += 1;
    let unclassifiedCount = 0;
    const classified = new Set([...next.memberships.values()].map((value) => value.sourceId));
    for (const id of next.favorites.keys()) if (!classified.has(id)) unclassifiedCount += 1;
    return { addedCount, existingCount, deletedCount, membershipChangedCount: affected.size, unclassifiedCount };
  }

  async function readCompleteSnapshot({ transport, onProgress, checkpoint, shouldPause }) {
    const snapshot = checkpoint?.snapshot || createSnapshot();
    const cursors = checkpoint?.cursors || { favorites: null, albums: null, memberships: null };
    const states = checkpoint?.states || { favorites: false, albums: false, memberships: false };
    const stats = checkpoint?.stats || { pageCount: 0, invalidCount: 0, duplicateCount: 0 };
    for (const kind of ["favorites", "albums", "memberships"]) {
      while (!states[kind]) {
        if (shouldPause?.()) return { status: "paused", snapshot, cursors, states, stats };
        const page = await transport.readPage(kind, cursors[kind]);
        if (page?.riskControl) return { status: "blocked", code: page.code || "RISK_CONTROL", snapshot, cursors, states, stats };
        if (!page || !Array.isArray(page.items)) throw new Error(`API ${kind} page is invalid`);
        const result = addPage(snapshot, kind, page);
        stats.pageCount += 1;
        stats.invalidCount += result.invalidCount;
        stats.duplicateCount += result.duplicateCount;
        cursors[kind] = page.nextCursor ?? null;
        states[kind] = !page.hasMore;
        onProgress?.({ kind, snapshot, cursors, states, stats, hasMore: Boolean(page.hasMore), total: Number(page.total) || 0 });
      }
    }
    return { status: "completed", snapshot, cursors, states, stats, verification: verifySnapshot(snapshot) };
  }

  globalThis.CollectionRevivalApiSyncCore = { SOURCE_TYPES, createSnapshot, addPage, verifySnapshot, diffSnapshots, readCompleteSnapshot };
})();
