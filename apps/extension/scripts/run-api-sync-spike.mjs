import vm from "node:vm";
import { readFileSync } from "node:fs";

const context = { console, Map, Set, Date, Promise, globalThis: null };
context.globalThis = context;
vm.runInNewContext(readFileSync(new URL("../src/api-sync/api-sync-core.js", import.meta.url), "utf8"), context);
vm.runInNewContext(readFileSync(new URL("../src/api-sync/api-sync-provider.js", import.meta.url), "utf8"), context);
const { ApiSyncProvider } = context.CollectionRevivalApiSyncProvider;

class MemoryStorage {
  constructor() { this.runs = new Map(); this.library = context.CollectionRevivalApiSyncCore.createSnapshot(); }
  async stageSnapshot(id, snapshot, progress, checkpoint) { const run = this.runs.get(id); this.runs.set(id, { ...run, status: "reading", snapshot, progress, checkpoint }); }
  async updateRun(id, patch) { const next = { ...this.runs.get(id), ...patch }; this.runs.set(id, next); return next; }
  async verifyRun(id) { const run = this.runs.get(id); const verification = context.CollectionRevivalApiSyncCore.verifySnapshot(run.snapshot); if (!verification.ok) return this.updateRun(id, { status: "failed", summary: verification }); return this.updateRun(id, { status: "awaiting_confirmation", summary: { ...verification, ...context.CollectionRevivalApiSyncCore.diffSnapshots(this.library, run.snapshot), invalidCount: run.progress.invalidCount } }); }
  async confirmImport(id) { const run = this.runs.get(id); if (run.status !== "awaiting_confirmation") throw new Error("not ready"); this.library = run.snapshot; return this.updateRun(id, { status: "imported" }); }
}

function pages(items, size = 137) { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => ({ items: items.slice(index * size, index * size + size), hasMore: index < Math.ceil(items.length / size) - 1, nextCursor: index + 1 })); }
function transport(data) { const sets = Object.fromEntries(Object.entries(data).map(([kind, items]) => [kind, pages(items)])); return { async readPage(kind, cursor) { return sets[kind][cursor || 0]; } }; }
function favorite(i) { return { sourceId: `note-${String(i).padStart(4, "0")}`, title: `t${i}`, author: "a", originalUrl: `https://www.xiaohongshu.com/explore/note-${i}` }; }
function albums() { return Array.from({ length: 30 }, (_, i) => ({ sourceAlbumId: `album-${i}`, sourceName: `A${i}`, sourceOrder: i })); }
function memberships(count, changed = false) { const result = []; for (let i = 1; i <= count; i++) { let album = i % 30; if (changed && i <= 10) album = (album + 1) % 30; result.push({ sourceId: favorite(i).sourceId, sourceAlbumId: `album-${album}` }); if (i % 500 === 0) result.push({ sourceId: favorite(i).sourceId, sourceAlbumId: `album-${(album + 2) % 30}` }); } return result; }
async function load(storage, id, data) { storage.runs.set(id, { runId: id, status: "ready" }); const provider = new ApiSyncProvider({ transport: transport(data), storage }); return provider.read(id); }

const storage = new MemoryStorage();
const initial = { favorites: Array.from({ length: 3000 }, (_, i) => favorite(i + 1)), albums: albums(), memberships: memberships(3000) };
const first = await load(storage, "one", initial);
if (first.status !== "awaiting_confirmation" || first.summary.favoriteCount !== 3000 || first.summary.duplicateCount !== undefined || storage.library.favorites.size !== 0) throw new Error("3000 snapshot must remain staging before confirmation");
if (first.summary.invalidCount !== 0 || first.summary.albumCount !== 30 || first.summary.unclassifiedCount !== 0 || ![...storage.runs.get("one").snapshot.memberships.values()].some((value) => value.sourceId === "note-0500" && value.sourceAlbumId === "album-22")) throw new Error("album or membership verification failed");
await storage.confirmImport("one");
if (storage.library.favorites.size !== 3000 || storage.library.albums.size !== 30 || storage.library.memberships.size !== initial.memberships.length) throw new Error("first confirmation failed");
const next = { favorites: Array.from({ length: 3020 }, (_, i) => favorite(i + 1)).filter((value) => ![50, 51, 52, 53, 54].includes(Number(value.sourceId.slice(5)))), albums: albums(), memberships: memberships(3020, true).filter((value) => !["note-0050", "note-0051", "note-0052", "note-0053", "note-0054"].includes(value.sourceId)) };
const second = await load(storage, "two", next);
if (second.summary.addedCount !== 20 || second.summary.deletedCount !== 5 || second.summary.membershipChangedCount !== 10 || storage.library.favorites.size !== 3000) throw new Error(`second snapshot diff failed: ${JSON.stringify(second.summary)}`);
await storage.confirmImport("two");
if (storage.library.favorites.size !== 3015 || storage.library.memberships.size !== next.memberships.length) throw new Error("second confirmation must apply atomically");
console.log("M0 API sync generated tests ok: 3000 snapshot, 30 source albums, second full snapshot");
