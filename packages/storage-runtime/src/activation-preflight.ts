import {
  ACTIVE_ACTIVATION_JOURNAL_STATUSES,
  MIGRATION_EXECUTION_STORE_ORDER,
  computeStoreChecksum,
  verifyLegacyBackupEnvelope,
  type MigrationExecutionInspection,
  type MigrationExecutionMetadataRecord,
  type PersistedMigrationBackup,
  type ReadonlyStorageLike,
  type StorageActivationJournalV1,
  type StorageAdapter,
  type StorageEntityName
} from "@revival/storage-service";
import type { StorageRuntimeHealthReport } from "./contracts";
import type { IndexedDbRuntime } from "./indexeddb-runtime";
import { compareRuntimeStateBundles, type RuntimeEquivalenceResult } from "./runtime-equivalence";
import { checkSourceDrift, computeRuntimeBundleChecksum, type SourceDriftReport } from "./source-drift";
import type { StorageBootstrapMarkerReadResult, StorageBootstrapMarkerV1 } from "./bootstrap-marker";
export type ActivationPreflightIssueCode =
  | "ACTIVATION_SOURCE_DRIFT"
  | "ACTIVATION_TARGET_NOT_EQUIVALENT"
  | "ACTIVATION_BACKUP_INVALID"
  | "ACTIVATION_MIGRATION_NOT_COMPLETED"
  | "ACTIVATION_CONFLICT"
  | "ACTIVATION_MARKER_INVALID"
  | "ACTIVATION_JOURNAL_CONFLICT"
  | "ACTIVATION_MULTIPLE_ACTIVE_JOURNALS"
  | "ACTIVATION_CAPABILITY_UNAVAILABLE"
  | "ACTIVATION_TARGET_HEALTH_FAILED"
  | "ACTIVATION_STORE_CHECKSUM_MISMATCH";

export interface ActivationPreflightIssue {
  code: ActivationPreflightIssueCode;
  severity: "blocking" | "warning";
  scope: "source" | "target" | "backup" | "migration" | "capability" | "coordination";
  safePath?: string;
}

export interface ActivationCapabilityStatus {
  webLocks: boolean;
  webCrypto: boolean;
  indexedDB: boolean;
  indexedDbDatabases: boolean;
  broadcastChannel: boolean;
  storageEvent: boolean;
  localStorageReadable: boolean;
  adapterAvailable: boolean;
  blocking: string[];
  warnings: string[];
}

export interface ActivationBackupStatus {
  verified: boolean;
  rawChecksumMatches: boolean;
  normalizedChecksumMatchesMetadata: boolean;
}

export interface ActivationMigrationStatus {
  completed: boolean;
  activeStorageSwitched: false;
  noOtherActiveMigration: boolean;
  checkpointsVerified: boolean;
  storeChecksumsVerified: boolean;
}

export interface ActivationMultiTabStatus {
  markerState: "missing" | "legacy_active" | "activation_prepared" | "activating" | "indexeddb_active" | "recovery_required" | "invalid";
  activeJournalCount: number;
  consistent: boolean;
}

export interface ActivationPreflightReport {
  eligible: boolean;
  blocking: boolean;
  migrationId: string;
  activationCandidateId: string;
  sourceDrift: Omit<SourceDriftReport, "currentBundle" | "sourceBundle">;
  legacyHealth: StorageRuntimeHealthReport;
  targetHealth: StorageRuntimeHealthReport;
  equivalence: RuntimeEquivalenceResult;
  backupStatus: ActivationBackupStatus;
  migrationStatus: ActivationMigrationStatus;
  capabilityStatus: ActivationCapabilityStatus;
  multiTabStatus: ActivationMultiTabStatus;
  issues: ActivationPreflightIssue[];
  checkedAt: string;
}

export interface ActivationPreflightEvidence {
  sourceRawChecksum: string;
  sourceNormalizedChecksum: string;
  targetRuntimeChecksum: string;
  marker: StorageBootstrapMarkerV1 | undefined;
  bootstrapRevisionBefore: number | null;
}

export interface ActivationPreflightResult {
  report: ActivationPreflightReport;
  evidence?: ActivationPreflightEvidence;
}

export interface ActivationPreflightInput {
  readonlyStorage: ReadonlyStorageLike;
  inspections: MigrationExecutionInspection[];
  persistedBackup?: PersistedMigrationBackup;
  targetAdapter: StorageAdapter;
  targetRuntime: IndexedDbRuntime;
  markerRead: StorageBootstrapMarkerReadResult;
  journals: StorageActivationJournalV1[];
  capabilities: ActivationCapabilityStatus;
  activationCandidateId: string;
  now?: () => Date;
}

export async function runActivationPreflight(input: ActivationPreflightInput): Promise<ActivationPreflightResult> {
  const now = input.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const issues: ActivationPreflightIssue[] = [];
  addCapabilityIssues(input.capabilities, issues);
  const unresolved = input.inspections.filter((entry) => entry.status !== "rolled_back");
  const inspection = unresolved.length === 1 ? unresolved[0] : undefined;
  const metadata = inspection?.metadata;
  const migrationId = inspection?.migrationId ?? "unavailable";

  if (!inspection || !metadata || inspection.status !== "completed" || metadata.activeStorageSwitched !== false) {
    issues.push(blocking("ACTIVATION_MIGRATION_NOT_COMPLETED", "migration"));
  }
  if (unresolved.length > 1) issues.push(blocking("ACTIVATION_CONFLICT", "migration"));

  const multiTabStatus = inspectMarkerJournalConsistency(input.markerRead, input.journals, migrationId);
  if (!multiTabStatus.consistent) issues.push(blocking("ACTIVATION_JOURNAL_CONFLICT", "coordination"));
  if (multiTabStatus.activeJournalCount > 1) issues.push(blocking("ACTIVATION_MULTIPLE_ACTIVE_JOURNALS", "coordination"));
  if (input.markerRead.status === "invalid" || input.markerRead.status === "unsupported") {
    issues.push(blocking("ACTIVATION_MARKER_INVALID", "coordination"));
  }

  let backupStatus: ActivationBackupStatus = { verified: false, rawChecksumMatches: false, normalizedChecksumMatchesMetadata: false };
  let sourceDrift = unavailableDrift(checkedAt);
  if (metadata && input.persistedBackup) {
    const backupVerification = await verifyLegacyBackupEnvelope(input.persistedBackup.envelope).catch(() => undefined);
    const envelopeNormalized = input.persistedBackup.envelope.checksums.normalized ?? input.persistedBackup.envelope.normalizedSnapshot?.checksum;
    backupStatus = {
      verified: Boolean(backupVerification?.valid && backupVerification.rawChecksumValid !== false && backupVerification.normalizedChecksumValid !== false),
      rawChecksumMatches: Boolean(input.persistedBackup.envelope.checksums.raw),
      normalizedChecksumMatchesMetadata: Boolean(metadata.sourceSnapshotChecksum && envelopeNormalized === metadata.sourceSnapshotChecksum)
    };
    if (!backupStatus.verified || !backupStatus.rawChecksumMatches || !backupStatus.normalizedChecksumMatchesMetadata) {
      issues.push(blocking("ACTIVATION_BACKUP_INVALID", "backup"));
    }
    sourceDrift = await checkSourceDrift({
      readonlyStorage: input.readonlyStorage,
      migrationMetadata: metadata,
      backup: input.persistedBackup,
      now
    });
    if (sourceDrift.blocking || sourceDrift.drifted) issues.push(blocking("ACTIVATION_SOURCE_DRIFT", "source"));
  } else {
    issues.push(blocking("ACTIVATION_BACKUP_INVALID", "backup"));
  }

  const legacyHealth: StorageRuntimeHealthReport = {
    ok: !sourceDrift.blocking,
    kind: "localStorage",
    schemaVersion: sourceDrift.currentBundle?.state.schemaVersion,
    issues: sourceDrift.issues.map(() => ({ code: "RUNTIME_DATA_INVALID" as const, blocking: true })),
    checkedAt
  };

  let targetHealth: StorageRuntimeHealthReport = {
    ok: false,
    kind: "indexedDB",
    issues: [{ code: "RUNTIME_UNAVAILABLE", blocking: true }],
    checkedAt
  };
  let equivalence: RuntimeEquivalenceResult = { equivalent: false, differences: [{ path: "$", kind: "missing" }] };
  let targetRuntimeChecksum: string | undefined;
  let storeChecksumsVerified = false;
  try {
    targetHealth = await input.targetRuntime.healthCheck();
    if (!targetHealth.ok) issues.push(blocking("ACTIVATION_TARGET_HEALTH_FAILED", "target"));
    const targetLoad = await input.targetRuntime.loadAppState();
    const targetBundle = { state: targetLoad.state, settings: targetLoad.settings };
    targetRuntimeChecksum = await computeRuntimeBundleChecksum(targetBundle);
    if (sourceDrift.currentBundle) equivalence = compareRuntimeStateBundles(sourceDrift.currentBundle, targetBundle);
    if (!equivalence.equivalent) {
      issues.push(blocking("ACTIVATION_TARGET_NOT_EQUIVALENT", "target", equivalence.differences[0]?.path));
    }
    if (metadata) storeChecksumsVerified = await verifyTargetStoreChecksums(input.targetAdapter, metadata);
    if (!storeChecksumsVerified) issues.push(blocking("ACTIVATION_STORE_CHECKSUM_MISMATCH", "target"));
  } catch {
    issues.push(blocking("ACTIVATION_TARGET_HEALTH_FAILED", "target"));
  }

  const checkpointsVerified = Boolean(metadata?.checkpoints.length && metadata.checkpoints.every((checkpoint) => checkpoint.status === "verified"));
  const migrationStatus: ActivationMigrationStatus = {
    completed: Boolean(inspection?.status === "completed"),
    activeStorageSwitched: false,
    noOtherActiveMigration: unresolved.length === 1,
    checkpointsVerified,
    storeChecksumsVerified
  };
  if (!checkpointsVerified) issues.push(blocking("ACTIVATION_MIGRATION_NOT_COMPLETED", "migration"));

  const safeSourceDrift = stripDriftBundles(sourceDrift);
  const uniqueIssues = dedupeIssues(issues);
  const eligible = uniqueIssues.every((issue) => issue.severity !== "blocking") && Boolean(
    sourceDrift.currentRawChecksum && sourceDrift.currentNormalizedChecksum && targetRuntimeChecksum && metadata
  );
  const report: ActivationPreflightReport = {
    eligible,
    blocking: !eligible,
    migrationId,
    activationCandidateId: input.activationCandidateId,
    sourceDrift: safeSourceDrift,
    legacyHealth,
    targetHealth,
    equivalence,
    backupStatus,
    migrationStatus,
    capabilityStatus: input.capabilities,
    multiTabStatus,
    issues: uniqueIssues,
    checkedAt
  };
  return {
    report,
    ...(eligible ? {
      evidence: {
        sourceRawChecksum: sourceDrift.currentRawChecksum!,
        sourceNormalizedChecksum: sourceDrift.currentNormalizedChecksum!,
        targetRuntimeChecksum: targetRuntimeChecksum!,
        marker: input.markerRead.status === "valid" ? input.markerRead.marker : undefined,
        bootstrapRevisionBefore: input.markerRead.status === "valid" ? input.markerRead.marker.revision : null
      }
    } : {})
  };
}

export function inspectBrowserActivationCapabilities(options: {
  webLocks: boolean;
  webCrypto: boolean;
  indexedDB: boolean;
  indexedDbDatabases: boolean;
  broadcastChannel: boolean;
  storageEvent: boolean;
  localStorageReadable: boolean;
  adapterAvailable: boolean;
  completedSessionKnowsDatabaseExists?: boolean;
}): ActivationCapabilityStatus {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!options.webLocks) blocking.push("WEB_LOCKS_UNAVAILABLE");
  if (!options.webCrypto) blocking.push("WEB_CRYPTO_UNAVAILABLE");
  if (!options.indexedDB) blocking.push("INDEXEDDB_UNAVAILABLE");
  if (!options.localStorageReadable) blocking.push("LEGACY_SOURCE_UNREADABLE");
  if (!options.adapterAvailable) blocking.push("TARGET_ADAPTER_UNAVAILABLE");
  if (!options.indexedDbDatabases && !options.completedSessionKnowsDatabaseExists) blocking.push("DATABASE_ENUMERATION_UNAVAILABLE");
  else if (!options.indexedDbDatabases) warnings.push("DATABASE_ENUMERATION_UNAVAILABLE");
  if (!options.broadcastChannel && !options.storageEvent) blocking.push("MULTITAB_NOTIFICATION_UNAVAILABLE");
  else if (!options.broadcastChannel) warnings.push("BROADCAST_CHANNEL_UNAVAILABLE");
  return { ...options, blocking, warnings };
}

export function inspectMarkerJournalConsistency(
  markerRead: StorageBootstrapMarkerReadResult,
  journals: StorageActivationJournalV1[],
  migrationId?: string
): ActivationMultiTabStatus {
  const active = journals.filter((journal) => ACTIVE_ACTIVATION_JOURNAL_STATUSES.has(journal.status));
  const markerState = markerRead.status === "missing" ? "missing" : markerRead.status !== "valid" ? "invalid" : markerRead.marker.state;
  if (active.length > 1) return { markerState, activeJournalCount: active.length, consistent: false };
  const journal = active[0];
  if (markerRead.status === "missing") return { markerState, activeJournalCount: active.length, consistent: !journal };
  if (markerRead.status !== "valid") return { markerState, activeJournalCount: active.length, consistent: false };
  const marker = markerRead.marker;
  if (marker.state === "legacy_active") return { markerState, activeJournalCount: active.length, consistent: !journal };
  if (marker.state === "recovery_required") return { markerState, activeJournalCount: active.length, consistent: false };
  const consistent = Boolean(journal && journal.status === "prepared" &&
    journal.id === marker.journalId && journal.activationId === marker.activationId &&
    journal.migrationId === marker.migrationId && (!migrationId || journal.migrationId === migrationId) &&
    journal.sourceRawChecksum === marker.sourceRawChecksum &&
    journal.sourceNormalizedChecksum === marker.sourceNormalizedChecksum &&
    journal.targetRuntimeChecksum === marker.targetRuntimeChecksum &&
    journal.bootstrapRevisionPrepared === marker.revision);
  return { markerState, activeJournalCount: active.length, consistent };
}

export async function verifyTargetStoreChecksums(adapter: StorageAdapter, metadata: MigrationExecutionMetadataRecord): Promise<boolean> {
  const checkpoints = new Map(metadata.checkpoints.map((checkpoint) => [checkpoint.store, checkpoint]));
  for (const store of MIGRATION_EXECUTION_STORE_ORDER) {
    const records = await adapter.getAll(store);
    const checkpoint = checkpoints.get(store);
    if (!checkpoint) {
      if (records.length !== 0) return false;
      continue;
    }
    const expected = metadata.targetChecksums[store] ?? checkpoint.targetChecksum;
    if (checkpoint.status !== "verified" || !expected || records.length !== checkpoint.expectedCount) return false;
    if (await computeStoreChecksum(store, records as never[]) !== expected) return false;
  }
  return true;
}

async function checksumStore<K extends StorageEntityName>(adapter: StorageAdapter, store: K): Promise<string> {
  const records = await adapter.getAll(store);
  return computeStoreChecksum(store, records);
}
function addCapabilityIssues(status: ActivationCapabilityStatus, issues: ActivationPreflightIssue[]): void {
  for (const code of status.blocking) issues.push(blocking("ACTIVATION_CAPABILITY_UNAVAILABLE", "capability", `$.capabilities.${code}`));
  for (const code of status.warnings) issues.push({ code: "ACTIVATION_CAPABILITY_UNAVAILABLE", severity: "warning", scope: "capability", safePath: `$.capabilities.${code}` });
}

function blocking(code: ActivationPreflightIssueCode, scope: ActivationPreflightIssue["scope"], safePath?: string): ActivationPreflightIssue {
  return { code, severity: "blocking", scope, ...(safePath ? { safePath } : {}) };
}

function unavailableDrift(checkedAt: string): SourceDriftReport {
  return { drifted: false, blocking: true, changedDomains: [], issues: [{ code: "SOURCE_UNREADABLE", blocking: true }], checkedAt };
}

function stripDriftBundles(report: SourceDriftReport): Omit<SourceDriftReport, "currentBundle" | "sourceBundle"> {
  const {
    currentBundle: _current,
    sourceBundle: _source,
    currentRawChecksum: _currentRaw,
    currentNormalizedChecksum: _currentNormalized,
    expectedRawChecksum: _expectedRaw,
    expectedNormalizedChecksum: _expectedNormalized,
    ...safe
  } = report;
  return safe;
}

function dedupeIssues(issues: ActivationPreflightIssue[]): ActivationPreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.scope}:${issue.safePath ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}