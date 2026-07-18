import {
  LEGACY_ACHIEVEMENT_STORAGE_KEY,
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  LegacyLocalStorageSnapshotReader,
  canonicalJsonStringify,
  computeSha256,
  verifyLegacyBackupEnvelope,
  type LegacyBackupEnvelope,
  type MigrationExecutionMetadataRecord,
  type PersistedMigrationBackup,
  type ReadonlyStorageLike
} from "@revival/storage-service";
import { hydrateRuntimeSnapshot, type RuntimeStateBundle } from "./app-state-codec";

export const ACTIVATION_LEGACY_SOURCE_KEYS = [
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  LEGACY_ACHIEVEMENT_STORAGE_KEY
] as const;

export type SourceDriftDomain = "app_state" | "theme" | "achievements";
export type SourceDriftIssueCode =
  | "SOURCE_UNREADABLE"
  | "SOURCE_CHECKSUM_UNAVAILABLE"
  | "SOURCE_RAW_CHECKSUM_MISMATCH"
  | "SOURCE_NORMALIZED_CHECKSUM_MISMATCH"
  | "SOURCE_METADATA_CHECKSUM_MISSING"
  | "SOURCE_METADATA_BACKUP_CONFLICT"
  | "SOURCE_BACKUP_INVALID";

export interface SourceDriftIssue {
  code: SourceDriftIssueCode;
  blocking: true;
  domain?: SourceDriftDomain;
}

export interface SourceDriftReport {
  drifted: boolean;
  blocking: boolean;
  currentRawChecksum?: string;
  currentNormalizedChecksum?: string;
  expectedRawChecksum?: string;
  expectedNormalizedChecksum?: string;
  changedDomains: SourceDriftDomain[];
  issues: SourceDriftIssue[];
  checkedAt: string;
  currentBundle?: RuntimeStateBundle;
  sourceBundle?: RuntimeStateBundle;
}

export interface SourceDriftCheckInput {
  readonlyStorage: ReadonlyStorageLike;
  migrationMetadata: MigrationExecutionMetadataRecord;
  backup: PersistedMigrationBackup;
  now?: () => Date;
}

export async function checkSourceDrift(input: SourceDriftCheckInput): Promise<SourceDriftReport> {
  const now = input.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const issues: SourceDriftIssue[] = [];
  const changedDomains: SourceDriftDomain[] = [];
  const expectedEnvelope = input.backup.envelope;

  const backupVerification = await verifyLegacyBackupEnvelope(expectedEnvelope).catch(() => undefined);
  if (!backupVerification?.valid || backupVerification.rawChecksumValid === false || backupVerification.normalizedChecksumValid === false) {
    issues.push({ code: "SOURCE_BACKUP_INVALID", blocking: true });
  }

  const expectedRawChecksum = expectedEnvelope.checksums.raw;
  const metadataNormalizedChecksum = input.migrationMetadata.sourceSnapshotChecksum;
  const envelopeNormalizedChecksum = expectedEnvelope.checksums.normalized ?? expectedEnvelope.normalizedSnapshot?.checksum;
  if (!metadataNormalizedChecksum) issues.push({ code: "SOURCE_METADATA_CHECKSUM_MISSING", blocking: true });
  if (!expectedRawChecksum || !envelopeNormalizedChecksum) issues.push({ code: "SOURCE_CHECKSUM_UNAVAILABLE", blocking: true });
  if (metadataNormalizedChecksum && envelopeNormalizedChecksum && metadataNormalizedChecksum !== envelopeNormalizedChecksum) {
    issues.push({ code: "SOURCE_METADATA_BACKUP_CONFLICT", blocking: true });
  }

  let currentEnvelope: LegacyBackupEnvelope | undefined;
  try {
    currentEnvelope = await new LegacyLocalStorageSnapshotReader(input.readonlyStorage, {
      now,
      createBackupId: () => "activation-source-check"
    }).createBackupEnvelope();
  } catch {
    issues.push({ code: "SOURCE_UNREADABLE", blocking: true });
  }

  let currentBundle: RuntimeStateBundle | undefined;
  let sourceBundle: RuntimeStateBundle | undefined;
  let currentNormalizedChecksum: string | undefined;
  let expectedNormalizedChecksum: string | undefined;
  try {
    if (!currentEnvelope?.normalizedSnapshot || !expectedEnvelope.normalizedSnapshot) throw new Error("normalized source unavailable");
    currentBundle = runtimeBundleFromEnvelope(currentEnvelope);
    sourceBundle = runtimeBundleFromEnvelope(expectedEnvelope);
    [currentNormalizedChecksum, expectedNormalizedChecksum] = await Promise.all([
      computeRuntimeBundleChecksum(currentBundle),
      computeRuntimeBundleChecksum(sourceBundle)
    ]);
  } catch {
    issues.push({ code: "SOURCE_UNREADABLE", blocking: true });
  }

  const currentRawChecksum = currentEnvelope?.checksums.raw;
  if (!currentRawChecksum) issues.push({ code: "SOURCE_CHECKSUM_UNAVAILABLE", blocking: true });
  if (currentRawChecksum && expectedRawChecksum && currentRawChecksum !== expectedRawChecksum) {
    issues.push({ code: "SOURCE_RAW_CHECKSUM_MISMATCH", blocking: true });
  }
  if (currentNormalizedChecksum && expectedNormalizedChecksum && currentNormalizedChecksum !== expectedNormalizedChecksum) {
    issues.push({ code: "SOURCE_NORMALIZED_CHECKSUM_MISMATCH", blocking: true });
  }

  if (currentEnvelope) {
    compareDomain(currentEnvelope, expectedEnvelope, LEGACY_APP_STATE_STORAGE_KEY, "app_state", changedDomains);
    compareDomain(currentEnvelope, expectedEnvelope, LEGACY_THEME_STORAGE_KEY, "theme", changedDomains);
    compareDomain(currentEnvelope, expectedEnvelope, LEGACY_ACHIEVEMENT_STORAGE_KEY, "achievements", changedDomains);
  }

  return {
    drifted: changedDomains.length > 0 || Boolean(currentNormalizedChecksum && expectedNormalizedChecksum && currentNormalizedChecksum !== expectedNormalizedChecksum),
    blocking: issues.length > 0,
    currentRawChecksum,
    currentNormalizedChecksum,
    expectedRawChecksum,
    expectedNormalizedChecksum,
    changedDomains,
    issues: dedupeIssues(issues),
    checkedAt,
    currentBundle,
    sourceBundle
  };
}

export async function computeRuntimeBundleChecksum(bundle: RuntimeStateBundle): Promise<string> {
  return computeSha256(canonicalJsonStringify(bundle, { adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", recoverable: false }));
}

export function runtimeBundleFromEnvelope(envelope: LegacyBackupEnvelope): RuntimeStateBundle {
  if (!envelope.normalizedSnapshot) throw new Error("Normalized Snapshot is unavailable.");
  const hydrated = hydrateRuntimeSnapshot(envelope.normalizedSnapshot);
  return { state: hydrated.state, settings: hydrated.settings };
}

function compareDomain(
  current: LegacyBackupEnvelope,
  expected: LegacyBackupEnvelope,
  key: string,
  domain: SourceDriftDomain,
  output: SourceDriftDomain[]
): void {
  const currentValue = current.rawBackup.rawRecords[key] ?? null;
  const expectedValue = expected.rawBackup.rawRecords[key] ?? null;
  if (currentValue !== expectedValue) output.push(domain);
}

function dedupeIssues(issues: SourceDriftIssue[]): SourceDriftIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.domain ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}