import type {
  ActionCard,
  AppState,
  ClassificationCorrection,
  ImportBatch,
  ImportBatchItem,
  PlanCard,
  SavedItem,
  SearchLog,
  SmartAlbum
} from "@revival/shared-types";
import {
  STORAGE_ENTITY_NAMES,
  STORE_PRIMARY_KEYS,
  type JsonValue,
  type StorageEntityName,
  type StoragePrimaryKey,
  type StorageRecordMap,
  type StorageSnapshot,
  type StoredSetting
} from "./contracts";
import { StorageError } from "./errors";
import { assertNoDangerousJsonKeys, canonicalJsonStringify, cloneJsonSafe, DANGEROUS_JSON_KEYS } from "./json-utils";
import { createRuntimeMetadataSettings } from "./runtime-metadata";

export interface ReadonlyStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
}

export type LegacyStorageKeyCategory =
  | "appState"
  | "userSetting"
  | "achievement"
  | "internal"
  | "test"
  | "unknown";

export interface LegacyStorageKeyDefinition {
  key: string;
  category: LegacyStorageKeyCategory;
  defaultIncluded: boolean;
  sensitive: boolean;
  required: boolean;
}

export const LEGACY_APP_STATE_STORAGE_KEY = "collection-revival-system:v1";
export const LEGACY_THEME_STORAGE_KEY = "collection-revival-theme";
export const LEGACY_ACHIEVEMENT_STORAGE_KEY = "collection-revival-achievements";
export const LEGACY_REAL_USER_TEST_STORAGE_KEY = "collection-revival-real-user-tests:v1";
export const LEGACY_DEVELOPER_MODE_STORAGE_KEY = "developerMode";
export const LEGACY_QA_WRITE_TEST_STORAGE_KEY = "collection-revival-system:qa-write-test";

export const LEGACY_PRODUCT_STORAGE_KEYS = [
  {
    key: LEGACY_APP_STATE_STORAGE_KEY,
    category: "appState",
    defaultIncluded: true,
    sensitive: false,
    required: true
  },
  {
    key: LEGACY_THEME_STORAGE_KEY,
    category: "userSetting",
    defaultIncluded: true,
    sensitive: false,
    required: false
  },
  {
    key: LEGACY_ACHIEVEMENT_STORAGE_KEY,
    category: "achievement",
    defaultIncluded: true,
    sensitive: false,
    required: false
  },
  {
    key: LEGACY_REAL_USER_TEST_STORAGE_KEY,
    category: "test",
    defaultIncluded: false,
    sensitive: false,
    required: false
  },
  {
    key: LEGACY_DEVELOPER_MODE_STORAGE_KEY,
    category: "internal",
    defaultIncluded: false,
    sensitive: false,
    required: false
  },
  {
    key: LEGACY_QA_WRITE_TEST_STORAGE_KEY,
    category: "test",
    defaultIncluded: false,
    sensitive: false,
    required: false
  }
] as const satisfies readonly LegacyStorageKeyDefinition[];

export type LegacySnapshotIssueCode =
  | "KEY_MISSING"
  | "JSON_PARSE_FAILED"
  | "UNSUPPORTED_SCHEMA"
  | "INVALID_APP_STATE"
  | "INVALID_COLLECTION"
  | "INVALID_RECORD"
  | "DUPLICATE_ID"
  | "BROKEN_REFERENCE"
  | "UNMAPPED_FIELD"
  | "UNKNOWN_STORAGE_KEY"
  | "INTERNAL_KEY_EXCLUDED"
  | "SENSITIVE_KEY_EXCLUDED"
  | "CHECKSUM_UNAVAILABLE";

export interface LegacySnapshotIssue {
  code: LegacySnapshotIssueCode;
  severity: "info" | "warning" | "error";
  key?: string;
  store?: StorageEntityName;
  recordId?: StoragePrimaryKey;
  message: string;
  recoverable: boolean;
}

export interface LegacySnapshotReadReport {
  canExportRawBackup: boolean;
  canCreateNormalizedSnapshot: boolean;
  discoveredKeys: string[];
  includedKeys: string[];
  excludedKeys: string[];
  unknownKeys: string[];
  rawByteLength: number;
  sourceCounts: Partial<Record<StorageEntityName, number>>;
  normalizedCounts: Partial<Record<StorageEntityName, number>>;
  duplicateCounts: Partial<Record<StorageEntityName, number>>;
  skippedCounts: Partial<Record<StorageEntityName, number>>;
  issues: LegacySnapshotIssue[];
  createdAt: string;
}

export interface LegacyRawStorageBackup {
  formatVersion: number;
  source: "legacy-localStorage";
  createdAt: string;
  includedKeys: string[];
  excludedKeys: string[];
  missingRequiredKeys: string[];
  rawRecords: Record<string, string | null>;
  checksum?: string;
}

export interface LegacyBackupEnvelope {
  formatVersion: number;
  backupId: string;
  createdAt: string;
  source: "legacy-localStorage";
  rawBackup: LegacyRawStorageBackup;
  normalizedSnapshot?: StorageSnapshot;
  checksums: {
    raw?: string;
    normalized?: string;
    algorithm?: "SHA-256";
  };
  report: LegacySnapshotReadReport;
  appVersion?: string;
}

export interface LegacyBackupVerificationResult {
  valid: boolean;
  rawChecksumValid?: boolean;
  normalizedChecksumValid?: boolean;
  issues: LegacySnapshotIssue[];
}

export interface LegacySnapshotReaderOptions {
  includeInternal?: boolean;
  appVersion?: string;
  notes?: string;
}

export interface LegacyLocalStorageSnapshotReaderOptions {
  now?: () => Date;
  createBackupId?: () => string;
}

const LEGACY_BACKUP_FORMAT_VERSION = 1;
const STORAGE_SNAPSHOT_FORMAT_VERSION = 1;
const DEFAULT_LEGACY_SCHEMA_VERSION = 1;
const DEFAULT_TARGET_SCHEMA_VERSION = 1;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|secret|password|cookie|credential|access[_-]?token|xsec[_-]?token|auth[_-]?token)/i;

type MutableSnapshotRecords = Partial<{
  [K in StorageEntityName]: StorageRecordMap[K][];
}>;

type MutableCounts = Partial<Record<StorageEntityName, number>>;

interface ParsedJsonResult {
  value?: unknown;
  ok: boolean;
}

interface MapContext {
  issues: LegacySnapshotIssue[];
  sourceCounts: MutableCounts;
  duplicateCounts: MutableCounts;
  skippedCounts: MutableCounts;
}

export class LegacyLocalStorageSnapshotReader {
  private readonly now: () => Date;
  private readonly createBackupId: () => string;

  constructor(private readonly storage: ReadonlyStorageLike, options: LegacyLocalStorageSnapshotReaderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createBackupId = options.createBackupId ?? createSafeBackupId;
  }

  async createBackupEnvelope(options: LegacySnapshotReaderOptions = {}): Promise<LegacyBackupEnvelope> {
    const createdAt = this.now().toISOString();
    const issues: LegacySnapshotIssue[] = [];
    const discoveredKeys = discoverStorageKeys(this.storage, issues);
    const knownKeySet = new Set<string>(LEGACY_PRODUCT_STORAGE_KEYS.map((definition) => definition.key));
    const unknownKeys = discoveredKeys.filter((key) => !knownKeySet.has(key));
    const rawRecords: Record<string, string | null> = {};
    const includedKeys: string[] = [];
    const excludedKeys: string[] = [];
    const missingRequiredKeys: string[] = [];

    for (const definition of LEGACY_PRODUCT_STORAGE_KEYS) {
      const include = shouldIncludeDefinition(definition, options.includeInternal);
      if (!include) {
        excludedKeys.push(definition.key);
        issues.push(createIssue({
          code: definition.sensitive || isSensitiveStorageKey(definition.key) ? "SENSITIVE_KEY_EXCLUDED" : "INTERNAL_KEY_EXCLUDED",
          severity: "info",
          key: definition.key,
          message: "A non-product or internal localStorage key was excluded from the default backup.",
          recoverable: true
        }));
        continue;
      }

      const raw = safeGetItem(this.storage, definition.key, issues);
      rawRecords[definition.key] = raw;
      includedKeys.push(definition.key);
      if (raw === null && definition.required) {
        missingRequiredKeys.push(definition.key);
        issues.push(createIssue({
          code: "KEY_MISSING",
          severity: "error",
          key: definition.key,
          message: "Required legacy AppState key is missing.",
          recoverable: true
        }));
      }
    }

    for (const key of unknownKeys) {
      const sensitive = isSensitiveStorageKey(key);
      issues.push(createIssue({
        code: sensitive ? "SENSITIVE_KEY_EXCLUDED" : "UNKNOWN_STORAGE_KEY",
        severity: sensitive ? "warning" : "info",
        key,
        message: sensitive
          ? "An unknown sensitive-looking localStorage key was excluded without reading its value."
          : "An unknown localStorage key was discovered; its value was not read.",
        recoverable: true
      }));
    }

    const rawBackup: LegacyRawStorageBackup = {
      formatVersion: LEGACY_BACKUP_FORMAT_VERSION,
      source: "legacy-localStorage",
      createdAt,
      includedKeys,
      excludedKeys: [...excludedKeys, ...unknownKeys],
      missingRequiredKeys,
      rawRecords
    };

    const context: MapContext = {
      issues,
      sourceCounts: {},
      duplicateCounts: {},
      skippedCounts: {}
    };
    const parsed = parseLegacyAppState(rawRecords[LEGACY_APP_STATE_STORAGE_KEY] ?? null, issues);
    let normalizedSnapshot: StorageSnapshot | undefined;
    if (parsed.ok && isPlainRecord(parsed.value)) {
      normalizedSnapshot = createNormalizedStorageSnapshot(parsed.value, rawRecords, context, createdAt, options);
    }

    const report: LegacySnapshotReadReport = {
      canExportRawBackup: true,
      canCreateNormalizedSnapshot: Boolean(normalizedSnapshot),
      discoveredKeys,
      includedKeys,
      excludedKeys: rawBackup.excludedKeys,
      unknownKeys,
      rawByteLength: getRawByteLength(rawRecords),
      sourceCounts: context.sourceCounts,
      normalizedCounts: normalizedSnapshot?.counts ?? {},
      duplicateCounts: context.duplicateCounts,
      skippedCounts: context.skippedCounts,
      issues,
      createdAt
    };

    const checksums: LegacyBackupEnvelope["checksums"] = {};
    try {
      const rawChecksum = await computeSha256(createRawChecksumPayload(rawRecords));
      rawBackup.checksum = rawChecksum;
      checksums.raw = rawChecksum;
      checksums.algorithm = "SHA-256";
    } catch {
      issues.push(createIssue({
        code: "CHECKSUM_UNAVAILABLE",
        severity: "warning",
        message: "SHA-256 checksum is unavailable in the current runtime.",
        recoverable: true
      }));
    }

    if (normalizedSnapshot) {
      try {
        const normalizedChecksum = await computeSha256(canonicalJsonStringify(snapshotWithoutChecksum(normalizedSnapshot), storageJsonOptions("STORAGE_SNAPSHOT_INVALID")));
        normalizedSnapshot.checksum = normalizedChecksum;
        checksums.normalized = normalizedChecksum;
        checksums.algorithm = "SHA-256";
      } catch {
        issues.push(createIssue({
          code: "CHECKSUM_UNAVAILABLE",
          severity: "warning",
          message: "Normalized Snapshot checksum is unavailable in the current runtime.",
          recoverable: true
        }));
      }
    }

    return {
      formatVersion: LEGACY_BACKUP_FORMAT_VERSION,
      backupId: this.createBackupId(),
      createdAt,
      source: "legacy-localStorage",
      rawBackup,
      checksums,
      report,
      ...(normalizedSnapshot ? { normalizedSnapshot } : {}),
      ...(options.appVersion ? { appVersion: options.appVersion } : {})
    };
  }
}

export function createBrowserReadonlyStorage(): ReadonlyStorageLike {
  const storage = globalThis.localStorage;
  if (!storage) {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_UNAVAILABLE",
      message: "Browser localStorage is unavailable.",
      recoverable: true
    });
  }
  return storage;
}

export function parseLegacyAppState(rawValue: string | null, issues: LegacySnapshotIssue[] = []): ParsedJsonResult {
  if (rawValue === null) {
    issues.push(createIssue({
      code: "KEY_MISSING",
      severity: "error",
      key: LEGACY_APP_STATE_STORAGE_KEY,
      message: "Legacy AppState key is missing.",
      recoverable: true
    }));
    return { ok: false };
  }
  if (rawValue === "") {
    issues.push(createIssue({
      code: "JSON_PARSE_FAILED",
      severity: "error",
      key: LEGACY_APP_STATE_STORAGE_KEY,
      message: "Legacy AppState is empty and cannot be parsed as JSON.",
      recoverable: true
    }));
    return { ok: false };
  }

  try {
    const value = JSON.parse(rawValue, blockedKeyReviver) as unknown;
    if (!isPlainRecord(value)) {
      issues.push(createIssue({
        code: "INVALID_APP_STATE",
        severity: "error",
        key: LEGACY_APP_STATE_STORAGE_KEY,
        message: "Legacy AppState JSON is not an object.",
        recoverable: true
      }));
      return { ok: false };
    }
    return { ok: true, value };
  } catch (error) {
    issues.push(createIssue({
      code: error instanceof BlockedJsonKeyError ? "INVALID_APP_STATE" : "JSON_PARSE_FAILED",
      severity: "error",
      key: LEGACY_APP_STATE_STORAGE_KEY,
      message: error instanceof BlockedJsonKeyError
        ? "Legacy AppState contains a blocked object key."
        : "Legacy AppState JSON could not be parsed.",
      recoverable: true
    }));
    return { ok: false };
  }
}

export function serializeLegacyBackup(envelope: LegacyBackupEnvelope): string {
  assertNoDangerousJsonKeys(envelope, storageJsonOptions("STORAGE_SNAPSHOT_INVALID"));
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function parseLegacyBackup(serialized: string): LegacyBackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized, blockedKeyReviver) as unknown;
  } catch (error) {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_SNAPSHOT_INVALID",
      message: error instanceof BlockedJsonKeyError
        ? "Legacy backup contains a blocked object key."
        : "Legacy backup JSON could not be parsed.",
      recoverable: true,
      cause: error
    });
  }

  if (!isPlainRecord(parsed) || parsed.formatVersion !== LEGACY_BACKUP_FORMAT_VERSION || parsed.source !== "legacy-localStorage") {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_SNAPSHOT_INVALID",
      message: "Legacy backup envelope has an unsupported format or source.",
      recoverable: true
    });
  }
  if (!isPlainRecord(parsed.rawBackup) || !isPlainRecord(parsed.report)) {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_SNAPSHOT_INVALID",
      message: "Legacy backup envelope is missing rawBackup or report.",
      recoverable: true
    });
  }

  return parsed as unknown as LegacyBackupEnvelope;
}

export function createLegacyBackupBlob(serialized: string): Blob {
  if (typeof Blob === "undefined") {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_EXPORT_FAILED",
      message: "Blob is unavailable in the current runtime.",
      recoverable: true
    });
  }
  return new Blob([serialized], { type: "application/json;charset=utf-8" });
}

export function createLegacyBackupFilename(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "collection-revival-backup-unknown-time.json";
  }
  const stamp = [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    "-",
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds())
  ].join("");
  return `collection-revival-backup-${stamp}.json`;
}

export async function verifyLegacyBackupEnvelope(envelope: LegacyBackupEnvelope): Promise<LegacyBackupVerificationResult> {
  const issues: LegacySnapshotIssue[] = [];
  const clone = cloneJsonSafe(envelope, storageJsonOptions("STORAGE_SNAPSHOT_INVALID"));

  if (!isPlainRecord(clone) || clone.formatVersion !== LEGACY_BACKUP_FORMAT_VERSION || clone.source !== "legacy-localStorage") {
    issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "error",
      message: "Legacy backup envelope has an unsupported format or source.",
      recoverable: true
    }));
  }
  if (!clone.backupId || typeof clone.backupId !== "string") {
    issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "error",
      message: "Legacy backup envelope is missing backupId.",
      recoverable: true
    }));
  }
  if (typeof clone.createdAt !== "string" || Number.isNaN(Date.parse(clone.createdAt))) {
    issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "error",
      message: "Legacy backup envelope has an invalid createdAt.",
      recoverable: true
    }));
  }

  const rawBackup = clone.rawBackup;
  if (!isPlainRecord(rawBackup) || !isPlainRecord(rawBackup.rawRecords)) {
    issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "error",
      message: "Legacy backup rawBackup is invalid.",
      recoverable: true
    }));
    return { valid: false, issues };
  }

  for (const key of rawBackup.includedKeys ?? []) {
    if (typeof key !== "string") continue;
    if (isSensitiveStorageKey(key)) {
      issues.push(createIssue({
        code: "SENSITIVE_KEY_EXCLUDED",
        severity: "error",
        key,
        message: "Legacy backup unexpectedly includes a sensitive-looking key.",
        recoverable: true
      }));
    }
    if (!(key in rawBackup.rawRecords)) {
      issues.push(createIssue({
        code: "KEY_MISSING",
        severity: "error",
        key,
        message: "Legacy raw backup includedKeys does not match rawRecords.",
        recoverable: true
      }));
    }
  }

  const rawChecksum = clone.checksums?.raw ?? rawBackup.checksum;
  let rawChecksumValid: boolean | undefined;
  if (rawChecksum) {
    try {
      rawChecksumValid = await computeSha256(createRawChecksumPayload(rawBackup.rawRecords as Record<string, string | null>)) === rawChecksum;
      if (!rawChecksumValid) {
        issues.push(createIssue({
          code: "INVALID_RECORD",
          severity: "error",
          message: "Legacy raw backup checksum does not match.",
          recoverable: true
        }));
      }
    } catch {
      issues.push(createIssue({
        code: "CHECKSUM_UNAVAILABLE",
        severity: "warning",
        message: "Could not verify raw backup checksum in the current runtime.",
        recoverable: true
      }));
    }
  }

  let normalizedChecksumValid: boolean | undefined;
  if (clone.normalizedSnapshot) {
    validateSnapshotStructure(clone.normalizedSnapshot, issues);
    const normalizedChecksum = clone.checksums?.normalized ?? clone.normalizedSnapshot.checksum;
    if (normalizedChecksum) {
      try {
        normalizedChecksumValid = await computeSha256(canonicalJsonStringify(snapshotWithoutChecksum(clone.normalizedSnapshot), storageJsonOptions("STORAGE_SNAPSHOT_INVALID"))) === normalizedChecksum;
        if (!normalizedChecksumValid) {
          issues.push(createIssue({
            code: "INVALID_RECORD",
            severity: "error",
            message: "Normalized Snapshot checksum does not match.",
            recoverable: true
          }));
        }
      } catch {
        issues.push(createIssue({
          code: "CHECKSUM_UNAVAILABLE",
          severity: "warning",
          message: "Could not verify normalized Snapshot checksum in the current runtime.",
          recoverable: true
        }));
      }
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    rawChecksumValid,
    normalizedChecksumValid,
    issues
  };
}

export async function computeSha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === "undefined") {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_EXPORT_FAILED",
      message: "Web Crypto SHA-256 is unavailable.",
      recoverable: true
    });
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createNormalizedStorageSnapshot(
  state: Record<string, unknown>,
  rawRecords: Record<string, string | null>,
  context: MapContext,
  createdAt: string,
  options: LegacySnapshotReaderOptions
): StorageSnapshot {
  const records: MutableSnapshotRecords = {};
  const counts: MutableCounts = {};
  const sourceSchemaVersion = typeof state.schemaVersion === "number" ? state.schemaVersion : DEFAULT_LEGACY_SCHEMA_VERSION;

  addRecords(records, counts, "savedItems", collectStoreRecords("savedItems", state.savedItems, context));
  addRecords(records, counts, "importBatches", collectStoreRecords("importBatches", state.importBatches, context));
  addRecords(records, counts, "importBatchItems", collectImportBatchItems(state, context));
  addRecords(records, counts, "smartAlbums", collectStoreRecords("smartAlbums", state.smartAlbums, context));
  addRecords(records, counts, "actionCards", collectStoreRecords("actionCards", state.actionCards, context));
  addRecords(records, counts, "planCards", collectStoreRecords("planCards", state.planCards, context));
  addRecords(records, counts, "classificationCorrections", collectStoreRecords("classificationCorrections", state.classificationCorrections, context));
  addRecords(records, counts, "searchLogs", collectStoreRecords("searchLogs", state.searchLogs, context));

  const runtimeState = {
    ...(state as unknown as AppState),
    savedItems: records.savedItems ?? [],
    actionCards: records.actionCards ?? [],
    planCards: records.planCards ?? [],
    classificationCorrections: records.classificationCorrections ?? [],
    searchLogs: records.searchLogs ?? [],
    smartAlbums: records.smartAlbums ?? [],
    importBatches: records.importBatches ?? [],
    importBatchItems: records.importBatchItems ?? []
  } satisfies AppState;
  let runtimeSettings: StoredSetting[] = [];
  try {
    runtimeSettings = createRuntimeMetadataSettings(runtimeState, createdAt);
  } catch {
    context.issues.push(createIssue({
      code: "INVALID_APP_STATE",
      severity: "error",
      key: LEGACY_APP_STATE_STORAGE_KEY,
      message: "Legacy AppState cannot produce required runtime metadata.",
      recoverable: false
    }));
  }
  const settings = [
    ...collectLegacySettings(rawRecords, context, createdAt, options),
    ...runtimeSettings
  ];
  addRecords(records, counts, "settings", settings);

  checkBrokenReferences(records, context);

  return {
    formatVersion: STORAGE_SNAPSHOT_FORMAT_VERSION,
    sourceStorage: "localStorage",
    sourceSchemaVersion,
    createdAt,
    counts,
    records,
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    metadata: {
      userInitiated: true,
      includedStores: Object.keys(records) as StorageEntityName[],
      ...(options.appVersion ? { sourceAppVersion: options.appVersion } : {}),
      ...(options.notes ? { notes: options.notes } : {})
    }
  };
}

function collectStoreRecords<K extends StorageEntityName>(
  store: K,
  value: unknown,
  context: MapContext
): StorageRecordMap[K][] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    context.issues.push(createIssue({
      code: "INVALID_COLLECTION",
      severity: "error",
      store,
      message: `Legacy ${store} collection is not an array.`,
      recoverable: true
    }));
    return [];
  }
  context.sourceCounts[store] = value.length;
  const seen = new Set<StoragePrimaryKey>();
  const output: StorageRecordMap[K][] = [];
  value.forEach((record, index) => {
    const prepared = prepareLegacyRecord(store, record, context, index);
    if (!prepared) return;
    let id: StoragePrimaryKey;
    try {
      id = getLegacyPrimaryKey(store, prepared);
    } catch {
      context.skippedCounts[store] = (context.skippedCounts[store] ?? 0) + 1;
      context.issues.push(createIssue({
        code: "INVALID_RECORD",
        severity: "warning",
        store,
        message: `Legacy ${store} record at index ${index} is missing a valid primary key.`,
        recoverable: true
      }));
      return;
    }
    if (seen.has(id)) {
      context.duplicateCounts[store] = (context.duplicateCounts[store] ?? 0) + 1;
      context.skippedCounts[store] = (context.skippedCounts[store] ?? 0) + 1;
      context.issues.push(createIssue({
        code: "DUPLICATE_ID",
        severity: "warning",
        store,
        recordId: id,
        message: `Duplicate id in legacy ${store}; later duplicate was skipped from normalized Snapshot.`,
        recoverable: true
      }));
      return;
    }
    seen.add(id);
    output.push(prepared);
  });
  return output;
}

function collectImportBatchItems(state: Record<string, unknown>, context: MapContext): ImportBatchItem[] {
  const combined: unknown[] = [];
  if (state.importBatchItems !== undefined) {
    if (!Array.isArray(state.importBatchItems)) {
      context.issues.push(createIssue({
        code: "INVALID_COLLECTION",
        severity: "error",
        store: "importBatchItems",
        message: "Legacy importBatchItems collection is not an array.",
        recoverable: true
      }));
    } else {
      combined.push(...state.importBatchItems);
    }
  }
  const nested: unknown[] = [];
  if (Array.isArray(state.importBatches)) {
    for (const batch of state.importBatches) {
      if (!isPlainRecord(batch) || !Array.isArray(batch.items)) continue;
      for (const item of batch.items) {
        nested.push(isPlainRecord(item) && typeof item.batchId !== "string" ? { ...item, batchId: batch.id } : item);
      }
    }
  }
  combined.push(...nested);
  if (combined.length === 0) return [];
  return collectStoreRecords("importBatchItems", combined, context);
}

function prepareLegacyRecord<K extends StorageEntityName>(
  store: K,
  record: unknown,
  context: MapContext,
  index: number
): StorageRecordMap[K] | undefined {
  if (!isPlainRecord(record)) {
    context.skippedCounts[store] = (context.skippedCounts[store] ?? 0) + 1;
    context.issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "warning",
      store,
      message: `Legacy ${store} record at index ${index} is not an object.`,
      recoverable: true
    }));
    return undefined;
  }
  try {
    return cloneJsonSafe(record, storageJsonOptions("STORAGE_VALIDATION_FAILED")) as unknown as StorageRecordMap[K];
  } catch {
    context.skippedCounts[store] = (context.skippedCounts[store] ?? 0) + 1;
    context.issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "warning",
      store,
      message: `Legacy ${store} record at index ${index} is not JSON-safe.`,
      recoverable: true
    }));
    return undefined;
  }
}

function collectLegacySettings(
  rawRecords: Record<string, string | null>,
  context: MapContext,
  updatedAt: string,
  options: LegacySnapshotReaderOptions
): StoredSetting[] {
  const settings: StoredSetting[] = [];
  const theme = rawRecords[LEGACY_THEME_STORAGE_KEY];
  if (typeof theme === "string" && theme.length > 0) {
    settings.push(makeSetting("theme", theme, "appearance", false, updatedAt));
  }

  const achievementsRaw = rawRecords[LEGACY_ACHIEVEMENT_STORAGE_KEY];
  if (typeof achievementsRaw === "string" && achievementsRaw.length > 0) {
    const parsed = parseJsonKey(LEGACY_ACHIEVEMENT_STORAGE_KEY, achievementsRaw, context.issues);
    if (parsed.ok && isJsonValue(parsed.value)) {
      settings.push(makeSetting("achievements", parsed.value, "product", false, updatedAt));
    }
  }

  const developerModeRaw = rawRecords[LEGACY_DEVELOPER_MODE_STORAGE_KEY];
  if (options.includeInternal && typeof developerModeRaw === "string") {
    settings.push(makeSetting("developerMode", developerModeRaw === "true", "internal", true, updatedAt));
  }

  return settings;
}

function makeSetting(key: string, value: JsonValue, category: StoredSetting["category"], internal: boolean, updatedAt: string): StoredSetting {
  return {
    id: `setting-${key}`,
    key,
    value,
    category,
    internal,
    updatedAt,
    schemaVersion: DEFAULT_TARGET_SCHEMA_VERSION
  };
}

function checkBrokenReferences(records: MutableSnapshotRecords, context: MapContext): void {
  const savedItemIds = new Set((records.savedItems ?? []).map((item) => item.id));
  const actionCardIds = new Set((records.actionCards ?? []).map((card) => card.id));
  const batchIds = new Set((records.importBatches ?? []).map((batch) => batch.id));

  for (const item of records.importBatchItems ?? []) {
    if (!batchIds.has(item.batchId)) addBrokenReferenceIssue(context, "importBatchItems", item.id);
  }
  for (const card of records.actionCards ?? []) {
    if (!savedItemIds.has(card.savedItemId)) addBrokenReferenceIssue(context, "actionCards", card.id);
  }
  for (const plan of records.planCards ?? []) {
    if (!savedItemIds.has(plan.savedItemId) || !actionCardIds.has(plan.actionCardId)) {
      addBrokenReferenceIssue(context, "planCards", plan.id);
    }
  }
  for (const correction of records.classificationCorrections ?? []) {
    if (!savedItemIds.has(correction.savedItemId)) addBrokenReferenceIssue(context, "classificationCorrections", correction.id);
  }
  for (const album of records.smartAlbums ?? []) {
    for (const id of [...album.savedItemIds, ...album.recommendedItemIds, ...(album.suggestedItemIds ?? [])]) {
      if (!savedItemIds.has(id)) {
        addBrokenReferenceIssue(context, "smartAlbums", album.id);
        break;
      }
    }
  }
}

function addBrokenReferenceIssue(context: MapContext, store: StorageEntityName, recordId: StoragePrimaryKey): void {
  context.issues.push(createIssue({
    code: "BROKEN_REFERENCE",
    severity: "warning",
    store,
    recordId,
    message: `Legacy ${store} record references a missing related record.`,
    recoverable: true
  }));
}

function addRecords<K extends StorageEntityName>(
  records: MutableSnapshotRecords,
  counts: MutableCounts,
  store: K,
  values: StorageRecordMap[K][]
): void {
  counts[store] = values.length;
  if (values.length > 0) {
    (records as Record<string, unknown>)[store] = values;
  }
}

function parseJsonKey(key: string, raw: string, issues: LegacySnapshotIssue[]): ParsedJsonResult {
  try {
    return { ok: true, value: JSON.parse(raw, blockedKeyReviver) as unknown };
  } catch (error) {
    issues.push(createIssue({
      code: error instanceof BlockedJsonKeyError ? "INVALID_RECORD" : "JSON_PARSE_FAILED",
      severity: "warning",
      key,
      message: error instanceof BlockedJsonKeyError
        ? "Legacy setting JSON contains a blocked object key."
        : "Legacy setting JSON could not be parsed.",
      recoverable: true
    }));
    return { ok: false };
  }
}

function safeGetItem(storage: ReadonlyStorageLike, key: string, issues: LegacySnapshotIssue[]): string | null {
  try {
    return storage.getItem(key);
  } catch {
    issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "warning",
      key,
      message: "localStorage.getItem failed for an allowed key.",
      recoverable: true
    }));
    return null;
  }
}

function discoverStorageKeys(storage: ReadonlyStorageLike, issues: LegacySnapshotIssue[]): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    try {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    } catch {
      issues.push(createIssue({
        code: "UNKNOWN_STORAGE_KEY",
        severity: "warning",
        message: "A localStorage key name could not be read.",
        recoverable: true
      }));
    }
  }
  return keys;
}

function shouldIncludeDefinition(definition: LegacyStorageKeyDefinition, includeInternal = false): boolean {
  if (definition.sensitive || isSensitiveStorageKey(definition.key)) return false;
  if (definition.defaultIncluded) return true;
  return Boolean(includeInternal && (definition.category === "internal" || definition.category === "test"));
}

function isSensitiveStorageKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function getRawByteLength(rawRecords: Record<string, string | null>): number {
  return Object.values(rawRecords).reduce((total, value) => total + getByteLength(value ?? ""), 0);
}

function getByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function createRawChecksumPayload(rawRecords: Record<string, string | null>): string {
  const entries = Object.keys(rawRecords)
    .sort()
    .map((key) => {
      const value = rawRecords[key];
      return {
        key,
        value,
        byteLength: value === null ? 0 : getByteLength(value)
      };
    });
  return canonicalJsonStringify({ entries }, storageJsonOptions("STORAGE_SNAPSHOT_INVALID"));
}

function snapshotWithoutChecksum(snapshot: StorageSnapshot): StorageSnapshot {
  const cloned = cloneJsonSafe(snapshot, storageJsonOptions("STORAGE_SNAPSHOT_INVALID"));
  delete cloned.checksum;
  return cloned;
}

function validateSnapshotStructure(snapshot: StorageSnapshot, issues: LegacySnapshotIssue[]): void {
  if (!isPlainRecord(snapshot) || snapshot.formatVersion !== STORAGE_SNAPSHOT_FORMAT_VERSION) {
    issues.push(createIssue({
      code: "INVALID_RECORD",
      severity: "error",
      message: "Normalized Snapshot has an unsupported formatVersion.",
      recoverable: true
    }));
    return;
  }

  const records = snapshot.records ?? {};
  for (const [storeName, value] of Object.entries(records)) {
    if (!STORAGE_ENTITY_NAMES.includes(storeName as StorageEntityName)) {
      issues.push(createIssue({
        code: "INVALID_RECORD",
        severity: "error",
        message: "Normalized Snapshot contains an unsupported store.",
        recoverable: true
      }));
      continue;
    }
    const store = storeName as StorageEntityName;
    if (!Array.isArray(value)) {
      issues.push(createIssue({
        code: "INVALID_COLLECTION",
        severity: "error",
        store,
        message: `Normalized Snapshot records.${store} is not an array.`,
        recoverable: true
      }));
      continue;
    }
    if (snapshot.counts?.[store] !== undefined && snapshot.counts[store] !== value.length) {
      issues.push(createIssue({
        code: "INVALID_COLLECTION",
        severity: "error",
        store,
        message: `Normalized Snapshot count mismatch for ${store}.`,
        recoverable: true
      }));
    }
  }
}

function getLegacyPrimaryKey<K extends StorageEntityName>(store: K, value: StorageRecordMap[K]): StoragePrimaryKey {
  const keyField = STORE_PRIMARY_KEYS[store];
  const id = (value as unknown as Record<string, unknown>)[keyField];
  if ((typeof id !== "string" && typeof id !== "number") || id === "") {
    throw new StorageError({
      adapter: "localStorage",
      code: "STORAGE_VALIDATION_FAILED",
      message: `Legacy ${store} record is missing a valid primary key.`,
      recoverable: true,
      store
    });
  }
  return id;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonValue(value: unknown): value is JsonValue {
  try {
    cloneJsonSafe(value, storageJsonOptions("STORAGE_VALIDATION_FAILED"));
    return true;
  } catch {
    return false;
  }
}

function blockedKeyReviver(key: string, value: unknown): unknown {
  if (DANGEROUS_JSON_KEYS.has(key)) {
    throw new BlockedJsonKeyError();
  }
  return value;
}

class BlockedJsonKeyError extends Error {}

function createIssue(input: LegacySnapshotIssue): LegacySnapshotIssue {
  return {
    ...input,
    message: input.message
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
      .replace(/(xsec_token|token|access_token|api[_-]?key|cookie)=([^&\s]+)/gi, "$1=[redacted]")
      .slice(0, 240)
  };
}

function storageJsonOptions(code: "STORAGE_VALIDATION_FAILED" | "STORAGE_SNAPSHOT_INVALID") {
  return {
    adapter: "localStorage" as const,
    code,
    recoverable: true
  };
}

function createSafeBackupId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return `legacy_backup_${cryptoApi.randomUUID()}`;
  }
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return `legacy_backup_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `legacy_backup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
