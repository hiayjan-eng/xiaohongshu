import type { AppState } from "@revival/shared-types";
import {
  LEGACY_APP_STATE_STORAGE_KEY,
  RUNTIME_APP_METADATA_KEY,
  RUNTIME_ORDER_MANIFEST_KEY,
  LegacyLocalStorageSnapshotReader,
  createMemoryAdapter,
  createMigrationPreview,
  createMigrationPreviewUserSummary,
  createMigrationReport,
  validateMigrationSource,
  type LegacyBackupEnvelope,
  type MigrationIssueCode,
  type MigrationPreviewOptions
} from "../src/index";
import {
  FIXTURE_DATES,
  makeActionCard,
  makeBackup,
  makeClassificationCorrection,
  makeImportBatch,
  makeImportBatchItem,
  makeMigrationMetadata,
  makePlanCard,
  makeSavedItem,
  makeSmartAlbum
} from "./fixtures";
import { FakeReadonlyStorage, makeLargeLegacyAppState, makeLegacyAppState, makeLegacyStorage } from "./legacy-backup-fixtures";
import { TestHarness } from "./test-harness";

const CASE_COUNT = 21;

export function runMigrationPreviewTests(harness: TestHarness): void {
  harness.test("Migration preview: valid legacy envelope creates a read-only migration plan", async () => {
    const envelope = await createEnvelope();
    const report = await createPreview(envelope);
    harness.equal(report.sourceStorage, "legacy-localStorage", "source storage");
    harness.equal(report.targetStorage, "indexedDB", "target storage");
    harness.equal(report.summary.rawBackupAvailable, true, "raw backup available");
    harness.equal(report.summary.rollbackAvailable, true, "rollback available");
    harness.equal(report.stores.savedItems?.sourceCount, 1, "saved item count");
    harness.equal(report.stores.importBatches?.sourceCount, 1, "import batch count");
    harness.equal(report.stores.importBatchItems?.sourceCount, 1, "import batch item count");
    harness.equal(report.stores.smartAlbums?.sourceCount, 1, "album count");
    harness.equal(report.plan.storePlans.savedItems?.createCount, 1, "saved item planned create");
    harness.equal(report.plan.storePlans.actionCards?.createCount, 1, "action card planned create");
    harness.equal(report.summary.totalBlockingIssues, 0, "no blocking issues");
    harness.assert(report.issues.every((issue) => !issue.message.includes("xsec_token")), "messages are sanitized");
  });

  harness.test("Migration preview: runtime metadata and order manifest are required for activation readiness", async () => {
    const valid = await createPreview(await createEnvelope());
    harness.assert(valid.preservationChecks.some((check) => check.field === "runtimeMetadata" && check.status === "passed"), "runtime metadata preserved");
    harness.assert(valid.preservationChecks.some((check) => check.field === "runtimeOrder" && check.status === "passed"), "runtime order preserved");
    const envelope = cloneEnvelope(await createEnvelope());
    envelope.normalizedSnapshot!.records.settings = (envelope.normalizedSnapshot!.records.settings ?? []).filter((setting) =>
      setting.key !== RUNTIME_APP_METADATA_KEY && setting.key !== RUNTIME_ORDER_MANIFEST_KEY
    );
    const blocked = await createPreview(envelope);
    harness.assert(hasIssue(blocked.issues, "RUNTIME_METADATA_NOT_PRESERVED"), "missing runtime metadata blocks");
    harness.assert(hasIssue(blocked.issues, "RUNTIME_ORDER_NOT_PRESERVED"), "missing runtime order blocks");
    harness.equal(blocked.summary.canProceed, false, "activation readiness blocked");
  });
  harness.test("Migration preview: user summary and MigrationReport are JSON-safe", async () => {
    const report = await createPreview(await createEnvelope());
    const userSummary = createMigrationPreviewUserSummary(report);
    const migrationReport = createMigrationReport(report);
    harness.equal(userSummary.counts.savedItems, 1, "summary saved count");
    harness.assert(["ready_to_migrate", "review_required"].includes(userSummary.nextStep), "summary next step");
    harness.equal(migrationReport.sourceBackupId, "legacy_backup_test", "report source backup id");
    harness.equal(migrationReport.planVersion, report.plan.planVersion, "report plan version");
    harness.assert(JSON.stringify(report).length > 0, "preview report serializes");
    harness.assert(JSON.stringify(userSummary).length > 0, "user summary serializes");
    harness.assert(JSON.stringify(migrationReport).length > 0, "migration report serializes");
  });

  harness.test("Migration source validation: rejects unsupported backup and missing normalized Snapshot", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.formatVersion = 999;
    delete invalid.normalizedSnapshot;
    const result = await validateMigrationSource(invalid, previewOptions());
    harness.equal(result.valid, false, "invalid source");
    harness.assert(hasIssue(result.issues, "UNSUPPORTED_BACKUP_FORMAT"), "unsupported backup issue");
    harness.assert(hasIssue(result.issues, "NORMALIZED_SNAPSHOT_MISSING"), "missing snapshot issue");
  });

  harness.test("Migration source validation: detects raw and normalized checksum mismatch", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY] = String(invalid.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY] ?? "") + "tampered";
    invalid.normalizedSnapshot!.records.savedItems![0] = {
      ...invalid.normalizedSnapshot!.records.savedItems![0]!,
      userNote: "tampered note"
    };
    const report = await createPreview(invalid);
    harness.assert(hasIssue(report.issues, "RAW_CHECKSUM_MISMATCH"), "raw checksum mismatch");
    harness.assert(hasIssue(report.issues, "NORMALIZED_CHECKSUM_MISMATCH"), "normalized checksum mismatch");
    harness.equal(report.summary.canProceed, false, "checksum mismatch blocks migration");
  });

  harness.test("Migration preview: detects count mismatches and unsupported stores", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.counts.savedItems = 999;
    (invalid.normalizedSnapshot!.records as Record<string, unknown>).extensionCheckpoints = [];
    const report = await createPreview(invalid);
    harness.assert(hasIssue(report.issues, "COUNT_MISMATCH"), "count mismatch issue");
    harness.assert(hasIssue(report.issues, "STORE_NOT_SUPPORTED"), "unsupported store issue");
  });

  harness.test("Migration preview: detects duplicate primary keys", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.records.savedItems = [
      makeSavedItem("saved-dup"),
      makeSavedItem("saved-dup", { title: "duplicate" })
    ];
    invalid.normalizedSnapshot!.counts.savedItems = 2;
    const report = await createPreview(invalid);
    harness.assert(hasIssue(report.issues, "DUPLICATE_PRIMARY_KEY"), "duplicate primary key");
    harness.equal(report.stores.savedItems?.duplicatePrimaryKeyCount, 1, "duplicate primary key count");
    harness.equal(report.summary.canProceed, false, "duplicate blocks migration");
  });

  harness.test("Migration preview: detects source identity and normalized URL duplicates", async () => {
    const state = makeLegacyAppState({
      savedItems: [
        withLegacySourceItemId(makeSavedItem("saved-001", { sourceUrl: "https://example.test/item?a=1&b=2" }), "source-same"),
        withLegacySourceItemId(makeSavedItem("saved-002", { sourceUrl: "https://example.test/item?b=2&a=1" }), "source-same")
      ]
    });
    const report = await createPreview(await createEnvelopeFromState(state));
    harness.assert(hasIssue(report.issues, "SOURCE_ITEM_ID_DUPLICATE"), "source item duplicate");
    harness.assert(hasIssue(report.issues, "NORMALIZED_URL_DUPLICATE"), "normalized URL duplicate");
    harness.assert(report.duplicateGroups.length >= 2, "duplicate groups");
    harness.equal(report.plan.requiresUserConfirmation, true, "duplicates require confirmation");
  });

  harness.test("Migration preview: detects broken required and optional references", async () => {
    const state = makeLegacyAppState({
      importBatchItems: [makeImportBatchItem("batch-item-broken", { batchId: "missing-batch", createdSavedItemId: "missing-saved" })],
      actionCards: [makeActionCard("action-broken", { savedItemId: "missing-saved" })],
      planCards: [makePlanCard("plan-broken", { savedItemId: "missing-saved", actionCardId: "missing-action" })],
      smartAlbums: [makeSmartAlbum("album-broken", { savedItemIds: ["saved-001"], recommendedItemIds: ["missing-saved"] })],
      classificationCorrections: [makeClassificationCorrection("correction-broken", { savedItemId: "missing-saved" })]
    });
    const report = await createPreview(await createEnvelopeFromState(state));
    harness.assert(hasIssue(report.issues, "BROKEN_REQUIRED_REFERENCE"), "required reference issue");
    harness.assert(hasIssue(report.issues, "BROKEN_OPTIONAL_REFERENCE"), "optional reference issue");
    harness.assert(report.brokenReferences.length >= 5, "broken references captured");
    harness.equal(report.summary.canProceed, false, "broken required references block");
  });

  harness.test("Migration preview: detects preservation failures for user fields", async () => {
    const envelope = await createEnvelopeFromState(makeLegacyAppState({
      savedItems: [
        makeSavedItem("saved-001", {
          userEditedTitle: "manual title"
        } as never)
      ]
    }));
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.records.savedItems![0] = {
      ...invalid.normalizedSnapshot!.records.savedItems![0]!,
      sourceUrl: "https://example.test/changed",
      userNote: "changed note",
      userEditedTitle: "changed title",
      contentDomain: "Changed domain" as never
    };
    invalid.normalizedSnapshot!.records.settings = (invalid.normalizedSnapshot!.records.settings ?? []).filter((setting) => setting.key !== "theme");
    invalid.normalizedSnapshot!.records.classificationCorrections = [];
    const report = await createPreview(invalid);
    harness.assert(hasIssue(report.issues, "USER_NOTE_NOT_PRESERVED"), "user note preservation issue");
    harness.assert(hasIssue(report.issues, "USER_EDITED_TITLE_NOT_PRESERVED"), "title preservation issue");
    harness.assert(hasIssue(report.issues, "SOURCE_URL_NOT_PRESERVED"), "source URL preservation issue");
    harness.assert(hasIssue(report.issues, "MANUAL_CLASSIFICATION_NOT_PRESERVED"), "classification preservation issue");
    harness.assert(hasIssue(report.issues, "CLASSIFICATION_CORRECTION_NOT_PRESERVED"), "correction preservation issue");
    harness.assert(hasIssue(report.issues, "THEME_NOT_PRESERVED"), "theme preservation issue");
  });

  harness.test("Migration preview: preserves album, action card and plan lifecycle states", async () => {
    const state = makeLegacyAppState({
      smartAlbums: [makeSmartAlbum("album-001", { status: "confirmed", confirmedAt: FIXTURE_DATES.now })],
      actionCards: [makeActionCard("action-001", { nextAction: "Do the specific test step." })],
      planCards: [makePlanCard("plan-001", { status: "cancelled", cancelledAt: FIXTURE_DATES.later })]
    });
    const report = await createPreview(await createEnvelopeFromState(state));
    harness.assert(report.preservationChecks.some((check) => check.field === "status" && check.store === "smartAlbums" && check.status === "passed"), "album status preserved");
    harness.assert(report.preservationChecks.some((check) => check.field === "nextAction" && check.store === "actionCards" && check.status === "passed"), "action content preserved");
    harness.assert(report.preservationChecks.some((check) => check.field === "status" && check.store === "planCards" && check.status === "passed"), "plan state preserved");
  });

  harness.test("Migration preview: compares identical target records as skip", async () => {
    const envelope = await createEnvelope();
    const target = createMemoryAdapter();
    await target.open();
    await target.put("savedItems", envelope.normalizedSnapshot!.records.savedItems![0]!);
    const report = await createPreview(envelope, { targetAdapter: target });
    harness.assert(hasIssue(report.issues, "TARGET_RECORD_IDENTICAL"), "identical target issue");
    harness.equal(report.plan.storePlans.savedItems?.skipCount, 1, "identical record skipped");
    harness.equal(report.plan.storePlans.savedItems?.createCount, 0, "identical record not created");
  });

  harness.test("Migration preview: compares conflicting target records without writing", async () => {
    const envelope = await createEnvelope();
    const target = createMemoryAdapter();
    await target.open();
    await target.put("savedItems", makeSavedItem("saved-001", { userNote: "different target note" }));
    const before = await target.get("savedItems", "saved-001");
    const report = await createPreview(envelope, { targetAdapter: target });
    const after = await target.get("savedItems", "saved-001");
    harness.assert(hasIssue(report.issues, "TARGET_RECORD_CONFLICT"), "target conflict issue");
    harness.equal(report.plan.storePlans.savedItems?.conflictCount, 1, "conflict operation");
    harness.equal(report.plan.executable, false, "conflict blocks execution");
    harness.deepEqual(after, before, "target was not modified");
  });

  harness.test("Migration preview: target read failures become manual review issues", async () => {
    const targetAdapter = {
      async getAll() {
        throw new Error("read failed with https://example.test/path?xsec_token=secret");
      }
    };
    const report = await createPreview(await createEnvelope(), { targetAdapter });
    harness.assert(hasIssue(report.issues, "REQUIRES_MANUAL_REVIEW"), "target read failure issue");
    harness.assert(report.issues.every((issue) => !issue.message.includes("secret")), "target errors are sanitized");
  });

  harness.test("Migration preview: skipped migration metadata and nested backups are not executed", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.records.migrationMetadata = [makeMigrationMetadata("migration-old")];
    invalid.normalizedSnapshot!.records.backups = [makeBackup("backup-old")];
    invalid.normalizedSnapshot!.counts.migrationMetadata = 1;
    invalid.normalizedSnapshot!.counts.backups = 1;
    const report = await createPreview(invalid);
    harness.equal(report.plan.storePlans.migrationMetadata?.manualReviewCount, 1, "migration metadata manual review");
    harness.equal(report.plan.storePlans.backups?.manualReviewCount, 1, "backup manual review");
    harness.assert(hasIssue(report.issues, "REQUIRES_MANUAL_REVIEW"), "migration metadata issue");
    harness.assert(hasIssue(report.issues, "DERIVED_DATA_WILL_REBUILD"), "backup rebuild issue");
  });

  harness.test("Migration preview: validates record status, date and JSON-safe shape", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.records.savedItems![0] = {
      ...invalid.normalizedSnapshot!.records.savedItems![0]!,
      status: "bad-status" as never,
      updatedAt: "not-a-date"
    };
    invalid.normalizedSnapshot!.records.settings = [
      {
        id: "setting-bad",
        key: "bad",
        value: "x",
        category: "unsupported" as never,
        internal: "no" as never,
        updatedAt: "bad-date",
        schemaVersion: 1
      }
    ];
    const report = await createPreview(invalid);
    harness.assert(hasIssue(report.issues, "INVALID_STATUS"), "invalid status");
    harness.assert(hasIssue(report.issues, "INVALID_DATE"), "invalid date");
    harness.assert(hasIssue(report.issues, "INVALID_RECORD_SHAPE"), "invalid record shape");
  });

  harness.test("Migration preview: invalid primary key blocks and does not crash", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.records.savedItems = [{ title: "missing id" } as never];
    invalid.normalizedSnapshot!.counts.savedItems = 1;
    const report = await createPreview(invalid);
    harness.assert(hasIssue(report.issues, "MISSING_PRIMARY_KEY"), "missing primary key");
    harness.equal(report.stores.savedItems?.invalidCount, 1, "invalid count");
    harness.equal(report.summary.canProceed, false, "missing primary key blocks");
  });

  harness.test("Migration preview: issues are capped while counts remain complete", async () => {
    const state = makeLegacyAppState({
      savedItems: Array.from({ length: 8 }, (_, index) => makeSavedItem(`saved-${index}`, { status: "bad-status" as never }))
    });
    const report = await createPreview(await createEnvelopeFromState(state), { detailLimit: 3 });
    harness.assert((report.issueCountsByCode.INVALID_STATUS ?? 0) >= 8, "full issue count preserved");
    harness.assert(report.issues.filter((issue) => issue.code === "INVALID_STATUS").length <= 3, "detailed issues capped");
  });

  harness.test("Migration preview: large fixture produces deterministic counts and serializable report", async () => {
    const storage = makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeLargeLegacyAppState()) });
    const report = await createPreview(await createEnvelope(storage));
    harness.equal(report.stores.savedItems?.sourceCount, 3000, "large saved items");
    harness.equal(report.stores.importBatches?.sourceCount, 100, "large batches");
    harness.equal(report.stores.importBatchItems?.sourceCount, 3000, "large batch items");
    harness.equal(report.stores.smartAlbums?.sourceCount, 100, "large albums");
    harness.equal(report.stores.actionCards?.sourceCount, 300, "large action cards");
    harness.equal(report.stores.planCards?.sourceCount, 100, "large plan cards");
    harness.equal(report.stores.classificationCorrections?.sourceCount, 100, "large corrections");
    harness.assert(JSON.stringify(report).length > 1000, "large report serializes");
    harness.assert(report.summary.estimatedWorkload === "large" || report.summary.estimatedWorkload === "very_large", "large workload");
  });

  harness.test("Migration preview: no normalized Snapshot still produces a blocked report", async () => {
    const envelope = await createEnvelope(makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: "{bad" }));
    const report = await createPreview(envelope);
    harness.assert(hasIssue(report.issues, "NORMALIZED_SNAPSHOT_MISSING"), "missing normalized issue");
    harness.equal(report.summary.rawBackupAvailable, true, "raw backup retained");
    harness.equal(report.summary.canProceed, false, "cannot proceed without snapshot");
    harness.equal(report.plan.executable, false, "plan not executable");
  });

  harness.test("Migration preview: preview is read-only for legacy storage and adapters", async () => {
    const storage = makeLegacyStorage();
    const envelope = await createEnvelope(storage);
    const target = createMemoryAdapter();
    await target.open();
    await createPreview(envelope, { targetAdapter: target });
    harness.equal(storage.setItemCalls, 0, "legacy storage not written");
    harness.equal(storage.removeItemCalls, 0, "legacy storage not removed");
    harness.equal(storage.clearCalls, 0, "legacy storage not cleared");
    harness.equal((await target.getAll("savedItems")).length, 0, "target adapter not written");
  });

  harness.test("Migration preview: output does not expose full token URLs or notes in issue messages", async () => {
    const envelope = await createEnvelope();
    const invalid = cloneEnvelope(envelope);
    invalid.normalizedSnapshot!.records.savedItems = [
      makeSavedItem("saved-sensitive", {
        sourceUrl: "https://www.xiaohongshu.com/discovery/item/abc?xsec_token=very-secret",
        userNote: "private note should not appear"
      }),
      makeSavedItem("saved-sensitive-2", {
        sourceUrl: "https://www.xiaohongshu.com/discovery/item/abc?xsec_token=another-secret",
        userNote: "another private note"
      })
    ];
    invalid.normalizedSnapshot!.records.savedItems = invalid.normalizedSnapshot!.records.savedItems.map((item) =>
      withLegacySourceItemId(item, "same")
    );
    invalid.normalizedSnapshot!.counts.savedItems = 2;
    const report = await createPreview(invalid);
    const text = JSON.stringify(report.issues);
    harness.assert(!text.includes("very-secret"), "token value hidden");
    harness.assert(!text.includes("private note should not appear"), "user note hidden");
    harness.assert(!text.includes("another private note"), "second user note hidden");
  });
}

export function getMigrationPreviewCaseCount(): number {
  return CASE_COUNT;
}

async function createEnvelope(storage: FakeReadonlyStorage = makeLegacyStorage(), options?: Parameters<LegacyLocalStorageSnapshotReader["createBackupEnvelope"]>[0]): Promise<LegacyBackupEnvelope> {
  const reader = new LegacyLocalStorageSnapshotReader(storage, {
    now: () => new Date(FIXTURE_DATES.now),
    createBackupId: () => "legacy_backup_test"
  });
  return reader.createBackupEnvelope(options);
}

async function createEnvelopeFromState(state: AppState): Promise<LegacyBackupEnvelope> {
  return createEnvelope(makeLegacyStorage({ [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(state) }));
}

function previewOptions(options: MigrationPreviewOptions = {}): MigrationPreviewOptions {
  return {
    now: () => new Date(FIXTURE_DATES.now),
    createMigrationId: () => "migration_preview_test",
    ...options
  };
}

async function createPreview(envelope: LegacyBackupEnvelope, options: MigrationPreviewOptions = {}) {
  return createMigrationPreview(envelope, previewOptions(options));
}

function cloneEnvelope(envelope: LegacyBackupEnvelope): LegacyBackupEnvelope {
  return JSON.parse(JSON.stringify(envelope)) as LegacyBackupEnvelope;
}

function hasIssue(issues: Array<{ code: MigrationIssueCode }>, code: MigrationIssueCode): boolean {
  return issues.some((issue) => issue.code === code);
}

function withLegacySourceItemId<T extends ReturnType<typeof makeSavedItem>>(item: T, sourceItemId: string): T {
  return { ...item, sourceItemId } as T;
}
