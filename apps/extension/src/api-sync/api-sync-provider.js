(() => {
  class ApiSyncProvider {
    constructor({ transport, storage, onProgress }) { this.transport = transport; this.storage = storage; this.onProgress = onProgress; this.paused = false; }
    pause() { this.paused = true; }
    resume() { this.paused = false; }
    async read(runId, checkpoint) {
      const startedAt = Date.now();
      const result = await CollectionRevivalApiSyncCore.readCompleteSnapshot({ transport: this.transport, checkpoint, shouldPause: () => this.paused, onProgress: async (value) => {
        const progress = { favoriteCount: value.snapshot.favorites.size, albumCount: value.snapshot.albums.size, membershipCount: value.snapshot.memberships.size, pageCount: value.stats.pageCount, hasMore: value.hasMore, total: value.total, elapsedMs: Date.now() - startedAt, invalidCount: value.stats.invalidCount, duplicateCount: value.stats.duplicateCount };
        await this.storage.stageSnapshot(runId, value.snapshot, progress, { cursors: value.cursors, states: value.states, stats: value.stats }); this.onProgress?.(progress);
      } });
      if (result.status === "completed") { await this.storage.stageSnapshot(runId, result.snapshot, { favoriteCount: result.snapshot.favorites.size, albumCount: result.snapshot.albums.size, membershipCount: result.snapshot.memberships.size, pageCount: result.stats.pageCount, hasMore: false, elapsedMs: Date.now() - startedAt, invalidCount: result.stats.invalidCount, duplicateCount: result.stats.duplicateCount }, { cursors: result.cursors, states: result.states, stats: result.stats }); return this.storage.verifyRun(runId); }
      await this.storage.updateRun(runId, { status: result.status, checkpoint: { cursors: result.cursors, states: result.states, stats: result.stats }, lastErrorCode: result.code || "" }); return result;
    }
  }
  globalThis.CollectionRevivalApiSyncProvider = { ApiSyncProvider };
})();
