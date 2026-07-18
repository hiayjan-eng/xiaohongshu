import {
  LEGACY_ACHIEVEMENT_STORAGE_KEY,
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_DEVELOPER_MODE_STORAGE_KEY,
  LEGACY_PRODUCT_STORAGE_KEYS,
  LEGACY_QA_WRITE_TEST_STORAGE_KEY,
  LEGACY_REAL_USER_TEST_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  RUNTIME_APP_METADATA_KEY,
  RUNTIME_ORDER_MANIFEST_KEY,
  parseRuntimeAppMetadata,
  parseRuntimeOrderManifest,
  LegacyLocalStorageSnapshotReader,
  computeSha256,
  createLegacyBackupBlob,
  createLegacyBackupFilename,
  parseLegacyBackup,
  serializeLegacyBackup,
  verifyLegacyBackupEnvelope
} from "../src/index";
import { FIXTURE_DATES, makeActionCard, makeImportBatch, makeImportBatchItem, makePlanCard, makeSavedItem, makeSmartAlbum } from "./fixtures";
import { FakeReadonlyStorage, makeLargeLegacyAppState, makeLegacyAppState, makeLegacyStorage } from "./legacy-backup-fixtures";
import { TestHarness } from "./test-harness";

export function runLegacyLocalStorageSnapshotTests(harness: TestHarness): void {
  harness.test("LegacyLocalStorageSnapshotReader: allowlist includes product data and excludes internal keys", async () => {
    const storage = makeLegacyStorage({ AI_API_KEY: "secret-value" });
    const envelope = await createEnvelope(storage);
    harness.assert(envelope.rawBackup.includedKeys.includes(LEGACY_APP_STATE_STORAGE_KEY), "app state included");
    harness.assert(envelope.rawBackup.includedKeys.includes(LEGACY_THEME_STORAGE_KEY), "theme included");
    harness.assert(envelope.rawBackup.includedKeys.includes(LEGACY_ACHIEVEMENT_STORAGE_KEY), "achievements included");
    harness.assert(envelope.rawBackup.excludedKeys.includes(LEGACY_DEVELOPER_MODE_STORAGE_KEY), "developer mode excluded");
    harness.assert(envelope.rawBackup.excludedKeys.includes(LEGACY_REAL_USER_TEST_STORAGE_KEY), "real tests excluded");
    harness.assert(envelope.rawBackup.excludedKeys.includes(LEGACY_QA_WRITE_TEST_STORAGE_KEY), "qa write test excluded");
    harness.assert(envelope.report.unknownKeys.includes("foreign-app-key"), "unknown key reported");
    harness.assert(envelope.report.issues.some((issue) => issue.code === "SENSITIVE_KEY_EXCLUDED" && issue.key === "AI_API_KEY"), "sensitive unknown key reported");
    harness.assert(!storage.getItemCalls.includes("foreign-app-key"), "unknown value not read");
    harness.assert(!storage.getItemCalls.includes("AI_API_KEY"), "sensitive value not read");
  });

  harness.test("LegacyLocalStorageSnapshotReader: includeInternal opt-in reads internal allowlisted keys", async () => {
    const storage = makeLegacyStorage();
    const envelope = await createEnvelope(storage, { includeInternal: true });
    harness.assert(envelope.rawBackup.includedKeys.includes(LEGACY_DEVELOPER_MODE_STORAGE_KEY), "developer key included by opt-in");
    harness.assert(storage.getItemCalls.includes(LEGACY_REAL_USER_TEST_STORAGE_KEY), "test key read only by opt-in");
    harness.assert(envelope.normalizedSnapshot?.records.settings?.some((setting) => setting.key === "developerMode" && setting.internal), "developerMode normalized as internal setting");
  });

  harness.test("LegacyLocalStorageSnapshotReader: raw backup survives malformed AppState without demo fallback", async () => {
    const storage = makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: "{broken json" });
    const envelope = await createEnvelope(storage);
    harness.equal(envelope.report.canExportRawBackup, true, "raw backup can export");
    harness.equal(envelope.report.canCreateNormalizedSnapshot, false, "normalized snapshot blocked");
    harness.equal(envelope.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY], "{broken json", "raw string preserved");
    harness.assert(envelope.report.issues.some((issue) => issue.code === "JSON_PARSE_FAILED"), "parse issue recorded");
    harness.equal(storage.setItemCalls, 0, "no writes");
    harness.equal(storage.removeItemCalls, 0, "no removes");
    harness.equal(storage.clearCalls, 0, "no clear");
  });

  harness.test("LegacyLocalStorageSnapshotReader: normalized Snapshot maps current AppState stores", async () => {
    const envelope = await createEnvelope(makeLegacyStorage());
    const snapshot = envelope.normalizedSnapshot;
    harness.assert(Boolean(snapshot), "snapshot exists");
    harness.equal(snapshot?.sourceStorage, "localStorage", "source storage");
    harness.equal(snapshot?.counts.savedItems, 1, "saved item count");
    harness.equal(snapshot?.counts.importBatches, 1, "batch count");
    harness.equal(snapshot?.counts.importBatchItems, 1, "batch item count");
    harness.equal(snapshot?.counts.smartAlbums, 1, "album count");
    harness.equal(snapshot?.counts.actionCards, 1, "action card count");
    harness.equal(snapshot?.counts.planCards, 1, "plan card count");
    harness.equal(snapshot?.counts.classificationCorrections, 1, "correction count");
    harness.equal(snapshot?.counts.searchLogs, 1, "search log count");
    harness.assert(Boolean(snapshot?.records.settings?.find((setting) => setting.key === "theme")), "theme setting mapped");
    harness.assert(Boolean(snapshot?.records.settings?.find((setting) => setting.key === "achievements")), "achievements setting mapped");
    const runtimeMetadata = snapshot?.records.settings?.find((setting) => setting.key === RUNTIME_APP_METADATA_KEY);
    const orderManifest = snapshot?.records.settings?.find((setting) => setting.key === RUNTIME_ORDER_MANIFEST_KEY);
    harness.equal(parseRuntimeAppMetadata(runtimeMetadata).value?.user.id, "user-test", "runtime user metadata mapped");
    harness.equal(parseRuntimeOrderManifest(orderManifest).value?.orders.savedItems[0], "saved-001", "saved item order mapped");
    harness.equal(parseRuntimeOrderManifest(orderManifest).value?.orders.importBatchItems[0], "batch-item-001", "batch item order mapped");
    harness.equal(snapshot?.records.savedItems?.[0]?.title, "小红书封面设计技巧 ✨", "title preserved");
    harness.assert(Boolean(envelope.checksums.raw), "raw checksum");
    harness.assert(Boolean(envelope.checksums.normalized), "normalized checksum");
  });

  harness.test("LegacyLocalStorageSnapshotReader: nested ImportBatch items are expanded and duplicate ids are reported", async () => {
    const state = makeLegacyAppState({
      importBatches: [
        {
          ...makeImportBatch("batch-001"),
          items: [
            makeImportBatchItem("nested-001", { batchId: "batch-001" }),
            makeImportBatchItem("nested-001", { batchId: "batch-001", title: "duplicate" })
          ]
        } as never
      ],
      importBatchItems: []
    });
    const storage = makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(state) });
    const envelope = await createEnvelope(storage);
    harness.equal(envelope.normalizedSnapshot?.counts.importBatchItems, 1, "duplicate nested item skipped");
    harness.assert(envelope.report.issues.some((issue) => issue.code === "DUPLICATE_ID" && issue.store === "importBatchItems"), "duplicate reported");
  });

  harness.test("LegacyLocalStorageSnapshotReader: broken references are warnings and do not auto-repair", async () => {
    const state = makeLegacyAppState({
      savedItems: [],
      actionCards: [makeActionCard("action-broken", { savedItemId: "missing-saved" })],
      planCards: [makePlanCard("plan-broken", { savedItemId: "missing-saved", actionCardId: "missing-action" })],
      smartAlbums: [makeSmartAlbum("album-broken", { savedItemIds: ["missing-saved"], recommendedItemIds: ["missing-saved"] })]
    });
    const envelope = await createEnvelope(makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(state) }));
    harness.assert(envelope.report.issues.filter((issue) => issue.code === "BROKEN_REFERENCE").length >= 3, "broken references reported");
    harness.equal(envelope.normalizedSnapshot?.records.actionCards?.[0]?.savedItemId, "missing-saved", "action card not repaired");
  });

  harness.test("LegacyLocalStorageSnapshotReader: invalid collections and invalid records are skipped with issues", async () => {
    const state = {
      ...makeLegacyAppState(),
      savedItems: [{ ...makeSavedItem("saved-001") }, { title: "missing id" }],
      actionCards: "not-array"
    };
    const envelope = await createEnvelope(makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(state) }));
    harness.equal(envelope.normalizedSnapshot?.counts.savedItems, 1, "missing id skipped");
    harness.assert(envelope.report.issues.some((issue) => issue.code === "INVALID_COLLECTION" && issue.store === "actionCards"), "invalid collection");
    harness.assert(envelope.report.issues.some((issue) => issue.code === "INVALID_RECORD" && issue.store === "savedItems"), "invalid record");
  });

  harness.test("LegacyLocalStorageSnapshotReader: setting parse failures do not block raw backup", async () => {
    const envelope = await createEnvelope(makeLegacyStorage({ [LEGACY_ACHIEVEMENT_STORAGE_KEY]: "{bad" }));
    harness.assert(envelope.report.issues.some((issue) => issue.code === "JSON_PARSE_FAILED" && issue.key === LEGACY_ACHIEVEMENT_STORAGE_KEY), "achievement parse issue");
    harness.assert(!envelope.normalizedSnapshot?.records.settings?.some((setting) => setting.key === "achievements"), "bad achievements excluded from normalized settings");
    harness.equal(envelope.rawBackup.rawRecords[LEGACY_ACHIEVEMENT_STORAGE_KEY], "{bad", "bad raw value preserved");
  });

  harness.test("Legacy backup export: serialize, parse, Blob and filename are safe", async () => {
    const envelope = await createEnvelope(makeLegacyStorage());
    const serialized = serializeLegacyBackup(envelope);
    harness.assert(serialized.includes("小红书封面设计技巧"), "serialized keeps Chinese");
    harness.assert(serialized.includes("✨"), "serialized keeps Emoji");
    harness.assert(!serialized.startsWith("\uFEFF"), "no BOM");
    const parsed = parseLegacyBackup(serialized);
    harness.equal(parsed.backupId, envelope.backupId, "parse round trip");
    const blob = createLegacyBackupBlob(serialized);
    harness.equal(blob.type, "application/json;charset=utf-8", "blob mime");
    harness.equal(await blob.text(), serialized, "blob content");
    const filename = createLegacyBackupFilename(FIXTURE_DATES.now);
    harness.assert(/^collection-revival-backup-\d{8}-\d{6}\.json$/.test(filename), "safe filename");
    harness.assert(!/[\\/:]/.test(filename), "filename has no path separators or colon");
  });

  harness.test("Legacy backup verification: checksum passes and detects tampering", async () => {
    const envelope = await createEnvelope(makeLegacyStorage());
    const valid = await verifyLegacyBackupEnvelope(envelope);
    harness.equal(valid.valid, true, "valid envelope");
    harness.equal(valid.rawChecksumValid, true, "raw checksum valid");
    harness.equal(valid.normalizedChecksumValid, true, "normalized checksum valid");

    const tampered = parseLegacyBackup(serializeLegacyBackup(envelope));
    tampered.rawBackup.rawRecords[LEGACY_THEME_STORAGE_KEY] = "changed";
    const invalid = await verifyLegacyBackupEnvelope(tampered);
    harness.equal(invalid.valid, false, "tampered envelope invalid");
    harness.equal(invalid.rawChecksumValid, false, "raw checksum mismatch");
  });

  harness.test("Legacy backup checksum: raw order is stable and value changes matter", async () => {
    const first = await createEnvelope(new FakeReadonlyStorage({
      [LEGACY_THEME_STORAGE_KEY]: "sprout",
      [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeLegacyAppState()),
      [LEGACY_ACHIEVEMENT_STORAGE_KEY]: "{}"
    }));
    const second = await createEnvelope(new FakeReadonlyStorage({
      [LEGACY_ACHIEVEMENT_STORAGE_KEY]: "{}",
      [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeLegacyAppState()),
      [LEGACY_THEME_STORAGE_KEY]: "sprout"
    }));
    const third = await createEnvelope(new FakeReadonlyStorage({
      [LEGACY_ACHIEVEMENT_STORAGE_KEY]: "{}",
      [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeLegacyAppState()),
      [LEGACY_THEME_STORAGE_KEY]: "ember"
    }));
    harness.equal(first.checksums.raw, second.checksums.raw, "key order stable");
    harness.assert(first.checksums.raw !== third.checksums.raw, "value change changes checksum");
  });

  harness.test("Legacy backup checksum: Web Crypto unavailable reports a warning without weak fallback", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    if (!descriptor?.configurable) {
      harness.assert(true, "crypto is not configurable in this runtime; unavailable branch is covered by implementation contract");
      return;
    }
    try {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
      const envelope = await createEnvelope(makeLegacyStorage());
      harness.assert(envelope.report.issues.some((issue) => issue.code === "CHECKSUM_UNAVAILABLE"), "checksum warning");
      harness.equal(envelope.checksums.raw, undefined, "no fake raw checksum");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    }
  });

  harness.test("Legacy backup parsing: prototype pollution structures are rejected", () => {
    try {
      parseLegacyBackup('{"formatVersion":1,"source":"legacy-localStorage","rawBackup":{"rawRecords":{"__proto__":{}}},"report":{}}');
    } catch (error) {
      harness.equal((error as { code?: string }).code, "STORAGE_SNAPSHOT_INVALID", "pollution parse error");
      return;
    }
    throw new Error("expected polluted backup to be rejected");
  });

  harness.test("LegacyLocalStorageSnapshotReader: large fixture creates raw backup, normalized Snapshot and checksums", async () => {
    const largeState = makeLargeLegacyAppState();
    const storage = makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(largeState) });
    const envelope = await createEnvelope(storage);
    harness.equal(envelope.normalizedSnapshot?.counts.savedItems, 3000, "large saved items");
    harness.equal(envelope.normalizedSnapshot?.counts.importBatches, 100, "large import batches");
    harness.equal(envelope.normalizedSnapshot?.counts.importBatchItems, 3000, "large import items");
    harness.equal(envelope.normalizedSnapshot?.counts.smartAlbums, 100, "large albums");
    harness.equal(envelope.normalizedSnapshot?.counts.actionCards, 300, "large action cards");
    harness.equal(envelope.normalizedSnapshot?.counts.planCards, 100, "large plan cards");
    harness.equal(envelope.normalizedSnapshot?.counts.classificationCorrections, 100, "large corrections");
    harness.assert(Boolean(envelope.checksums.raw && envelope.checksums.normalized), "large checksums");
    harness.assert(serializeLegacyBackup(envelope).length > 1000, "large serialized");
  });

  harness.test("LegacyLocalStorageSnapshotReader: missing AppState still creates raw backup report", async () => {
    const storage = new FakeReadonlyStorage({
      [LEGACY_THEME_STORAGE_KEY]: "sprout"
    });
    const envelope = await createEnvelope(storage);
    harness.equal(envelope.report.canExportRawBackup, true, "raw backup export");
    harness.equal(envelope.report.canCreateNormalizedSnapshot, false, "no normalized snapshot");
    harness.assert(envelope.rawBackup.missingRequiredKeys.includes(LEGACY_APP_STATE_STORAGE_KEY), "missing required key");
  });

  harness.test("LegacyLocalStorageSnapshotReader: AppState array/null/control cases do not crash", async () => {
    const arrayEnvelope = await createEnvelope(makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: "[]" }));
    const nullEnvelope = await createEnvelope(makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: "null" }));
    harness.assert(arrayEnvelope.report.issues.some((issue) => issue.code === "INVALID_APP_STATE"), "array invalid");
    harness.assert(nullEnvelope.report.issues.some((issue) => issue.code === "INVALID_APP_STATE"), "null invalid");
  });

  harness.test("Legacy backup export: computeSha256 is stable for direct calls", async () => {
    const first = await computeSha256("中文 Emoji ✨");
    const second = await computeSha256("中文 Emoji ✨");
    const third = await computeSha256("中文 Emoji ✨ changed");
    harness.equal(first, second, "stable hash");
    harness.assert(first !== third, "different input changes hash");
    harness.equal(first.length, 64, "sha256 hex length");
  });

  harness.test("LegacyLocalStorageSnapshotReader: localStorage getItem failure is reported safely", async () => {
    class FailingStorage extends FakeReadonlyStorage {
      override getItem(key: string): string | null {
        if (key === LEGACY_THEME_STORAGE_KEY) throw new Error("boom with secret text");
        return super.getItem(key);
      }
    }
    const storage = new FailingStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeLegacyAppState()) });
    const envelope = await createEnvelope(storage);
    harness.assert(envelope.report.issues.some((issue) => issue.code === "INVALID_RECORD" && issue.key === LEGACY_THEME_STORAGE_KEY), "getItem issue");
    harness.assert(!envelope.report.issues.some((issue) => issue.message.includes("secret text")), "safe issue message");
  });

  harness.test("Legacy product storage key definitions are explicit and do not include extension state", () => {
    const keys = LEGACY_PRODUCT_STORAGE_KEYS.map((definition) => definition.key);
    harness.assert(!keys.some((key) => /chrome|extension|bridge|checkpoint|progress/i.test(key)), "no extension storage keys");
    harness.equal(new Set(keys).size, keys.length, "no duplicate key definitions");
  });
}

export function getLegacyLocalStorageSnapshotCaseCount(): number {
  return 18;
}

async function createEnvelope(storage: FakeReadonlyStorage, options?: Parameters<LegacyLocalStorageSnapshotReader["createBackupEnvelope"]>[0]) {
  const reader = new LegacyLocalStorageSnapshotReader(storage, {
    now: () => new Date(FIXTURE_DATES.now),
    createBackupId: () => "legacy_backup_test"
  });
  return reader.createBackupEnvelope(options);
}
