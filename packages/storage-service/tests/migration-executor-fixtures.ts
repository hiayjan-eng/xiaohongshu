import {
  LEGACY_APP_STATE_STORAGE_KEY,
  LegacyLocalStorageSnapshotReader,
  createMemoryAdapter,
  createMigrationPreview,
  type LegacyBackupEnvelope,
  type MemoryAdapter,
  type MigrationPreviewReport
} from "../src/index";
import { FIXTURE_DATES } from "./fixtures";
import { makeLegacyAppState, makeLegacyStorage, type FakeReadonlyStorage } from "./legacy-backup-fixtures";
import type { AppState } from "@revival/shared-types";

export interface MigrationExecutionFixture {
  envelope: LegacyBackupEnvelope;
  preview: MigrationPreviewReport;
  target: MemoryAdapter;
}

export async function createMigrationExecutionFixture(options: {
  state?: AppState;
  storage?: FakeReadonlyStorage;
  migrationId?: string;
  backupId?: string;
} = {}): Promise<MigrationExecutionFixture> {
  const storage = options.storage ?? makeLegacyStorage(
    options.state ? { [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(options.state) } : {}
  );
  const reader = new LegacyLocalStorageSnapshotReader(storage, {
    now: () => new Date(FIXTURE_DATES.now),
    createBackupId: () => options.backupId ?? "legacy_backup_execution"
  });
  const envelope = await reader.createBackupEnvelope();
  const target = createMemoryAdapter();
  await target.open();
  const preview = await createMigrationPreview(envelope, {
    now: () => new Date(FIXTURE_DATES.now),
    createMigrationId: () => options.migrationId ?? "migration_execution_test",
    targetAdapter: target
  });
  return { envelope, preview, target };
}

export function makeExecutionState(overrides: Partial<AppState> = {}): AppState {
  return makeLegacyAppState(overrides);
}
