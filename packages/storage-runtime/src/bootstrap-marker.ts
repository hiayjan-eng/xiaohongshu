import { canonicalJsonStringify } from "@revival/storage-service";
import { ActivationError } from "./activation-errors";

export const STORAGE_BOOTSTRAP_MARKER_KEY = "collection-revival-storage-bootstrap:v1";
export const STORAGE_BOOTSTRAP_MARKER_VERSION = 1;
const MARKER_JSON_OPTIONS = { adapter: "localStorage" as const, code: "STORAGE_VALIDATION_FAILED" as const, recoverable: false };

export type StorageBootstrapMarkerState = "legacy_active" | "activation_prepared" | "recovery_required";

export interface StorageBootstrapMarkerV1 {
  version: 1;
  revision: number;
  state: StorageBootstrapMarkerState;
  activeBackend: "localStorage";
  migrationId?: string;
  activationId?: string;
  journalId?: string;
  databaseName?: "collection-revival-local";
  schemaVersion?: 1;
  sourceRawChecksum?: string;
  sourceNormalizedChecksum?: string;
  targetRuntimeChecksum?: string;
  preparedAt?: string;
  updatedAt: string;
  errorCode?: string;
}

export interface BootstrapMarkerStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StorageBootstrapMarkerReadResult =
  | { status: "missing"; marker?: undefined }
  | { status: "valid"; marker: StorageBootstrapMarkerV1 }
  | { status: "invalid"; marker?: undefined; errorCode: "ACTIVATION_MARKER_INVALID" }
  | { status: "unsupported"; marker?: undefined; errorCode: "ACTIVATION_MARKER_VERSION_UNSUPPORTED" };

export interface StorageBootstrapMarkerStoreOptions {
  assertWriteLockHeld?: () => boolean;
}

export class StorageBootstrapMarkerStore {
  private readonly assertWriteLockHeld: () => boolean;

  constructor(private readonly storage: BootstrapMarkerStorageLike, options: StorageBootstrapMarkerStoreOptions = {}) {
    this.assertWriteLockHeld = options.assertWriteLockHeld ?? (() => false);
  }

  async read(): Promise<StorageBootstrapMarkerReadResult> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_BOOTSTRAP_MARKER_KEY);
    } catch (cause) {
      return { status: "invalid", errorCode: "ACTIVATION_MARKER_INVALID" };
    }
    if (raw === null) return { status: "missing" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "invalid", errorCode: "ACTIVATION_MARKER_INVALID" };
    }
    if (!isPlainRecord(parsed)) return { status: "invalid", errorCode: "ACTIVATION_MARKER_INVALID" };
    if (parsed.version !== STORAGE_BOOTSTRAP_MARKER_VERSION) {
      return { status: "unsupported", errorCode: "ACTIVATION_MARKER_VERSION_UNSUPPORTED" };
    }
    return isStorageBootstrapMarker(parsed)
      ? { status: "valid", marker: clone(parsed) }
      : { status: "invalid", errorCode: "ACTIVATION_MARKER_INVALID" };
  }

  async writeExpectedRevision(expectedRevision: number | null, next: StorageBootstrapMarkerV1): Promise<void> {
    this.ensureWriteLock();
    validateMarker(next);
    const current = await this.read();
    if (current.status === "invalid" || current.status === "unsupported") throw markerError(current.errorCode, false);
    const actualRevision = current.status === "valid" ? current.marker.revision : null;
    if (actualRevision !== expectedRevision || next.revision !== (expectedRevision ?? 0) + 1) {
      throw markerError("ACTIVATION_MARKER_REVISION_CONFLICT", true);
    }
    const serialized = canonicalJsonStringify(next, MARKER_JSON_OPTIONS);
    try {
      this.storage.setItem(STORAGE_BOOTSTRAP_MARKER_KEY, serialized);
    } catch (cause) {
      throw markerError("ACTIVATION_PREPARE_FAILED", true, cause);
    }
    const readBack = await this.read();
    if (readBack.status !== "valid" || canonicalJsonStringify(readBack.marker, MARKER_JSON_OPTIONS) !== serialized) {
      throw markerError("ACTIVATION_MARKER_INVALID", false);
    }
  }

  async removeExpectedRevision(expectedRevision: number): Promise<void> {
    this.ensureWriteLock();
    const current = await this.read();
    if (current.status !== "valid" || current.marker.revision !== expectedRevision || current.marker.activeBackend !== "localStorage") {
      throw markerError("ACTIVATION_MARKER_REVISION_CONFLICT", true);
    }
    try {
      this.storage.removeItem(STORAGE_BOOTSTRAP_MARKER_KEY);
    } catch (cause) {
      throw markerError("ACTIVATION_CANCEL_NOT_ALLOWED", true, cause);
    }
    if ((await this.read()).status !== "missing") throw markerError("ACTIVATION_MARKER_INVALID", false);
  }

  private ensureWriteLock(): void {
    if (!this.assertWriteLockHeld()) throw markerError("ACTIVATION_CONFLICT", true);
  }
}

export function createLegacyActiveMarker(previous: StorageBootstrapMarkerV1, updatedAt: string): StorageBootstrapMarkerV1 {
  return {
    version: 1,
    revision: previous.revision + 1,
    state: "legacy_active",
    activeBackend: "localStorage",
    updatedAt
  };
}

export function isStorageBootstrapMarker(value: unknown): value is StorageBootstrapMarkerV1 {
  if (!isPlainRecord(value)) return false;
  if (value.version !== 1 || !Number.isInteger(value.revision) || Number(value.revision) < 1) return false;
  if (value.state !== "legacy_active" && value.state !== "activation_prepared" && value.state !== "recovery_required") return false;
  if (value.activeBackend !== "localStorage" || !isIso(value.updatedAt)) return false;
  if (value.state === "activation_prepared") {
    if (![value.migrationId, value.activationId, value.journalId].every(nonEmptyString)) return false;
    if (value.databaseName !== "collection-revival-local" || value.schemaVersion !== 1 || !isIso(value.preparedAt)) return false;
    if (![value.sourceRawChecksum, value.sourceNormalizedChecksum, value.targetRuntimeChecksum].every(isSha256)) return false;
  }
  return optionalString(value.errorCode) && optionalString(value.migrationId) && optionalString(value.activationId) && optionalString(value.journalId);
}

function validateMarker(value: StorageBootstrapMarkerV1): void {
  if (!isStorageBootstrapMarker(value)) throw markerError("ACTIVATION_MARKER_INVALID", false);
}

function markerError(code: ConstructorParameters<typeof ActivationError>[0]["code"], recoverable: boolean, cause?: unknown): ActivationError {
  return new ActivationError({ code, recoverable, cause });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    !Object.keys(value).some((key) => key === "__proto__" || key === "constructor" || key === "prototype");
}

function nonEmptyString(value: unknown): boolean { return typeof value === "string" && value.length > 0; }
function optionalString(value: unknown): boolean { return value === undefined || nonEmptyString(value); }
function isIso(value: unknown): boolean { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isSha256(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function clone<T>(value: T): T { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T; }