import { APP_SCHEMA_VERSION, type AppState, type User } from "@revival/shared-types";
import type { JsonValue, StoredSetting } from "./contracts";

export const RUNTIME_APP_METADATA_KEY = "runtime:app-metadata:v1";
export const RUNTIME_ORDER_MANIFEST_KEY = "runtime:order-manifest:v1";
export const RUNTIME_METADATA_VERSION = 1;

export const RUNTIME_ORDERED_COLLECTIONS = [
  "savedItems",
  "actionCards",
  "planCards",
  "classificationCorrections",
  "searchLogs",
  "smartAlbums",
  "importBatches",
  "importBatchItems"
] as const;

export type RuntimeOrderedCollection = (typeof RUNTIME_ORDERED_COLLECTIONS)[number];

export const RUNTIME_COLLECTION_STORE_MAP = {
  savedItems: "savedItems",
  actionCards: "actionCards",
  planCards: "planCards",
  classificationCorrections: "classificationCorrections",
  searchLogs: "searchLogs",
  smartAlbums: "smartAlbums",
  importBatches: "importBatches",
  importBatchItems: "importBatchItems"
} as const;

export interface RuntimeAppMetadataValue {
  recordType: "runtime-app-metadata";
  version: 1;
  appSchemaVersion: number;
  user: User;
}

export interface RuntimeOrderManifestValue {
  recordType: "runtime-order-manifest";
  version: 1;
  orders: Record<RuntimeOrderedCollection, string[]>;
}

export interface RuntimeMetadataValidationResult<T> {
  valid: boolean;
  value?: T;
  reason?: "missing" | "unsupported" | "invalid";
}

export function createRuntimeMetadataSettings(state: AppState, updatedAt: string): [StoredSetting, StoredSetting] {
  const metadata: RuntimeAppMetadataValue = {
    recordType: "runtime-app-metadata",
    version: RUNTIME_METADATA_VERSION,
    appSchemaVersion: state.schemaVersion ?? APP_SCHEMA_VERSION,
    user: cloneUser(state.user)
  };
  const manifest: RuntimeOrderManifestValue = {
    recordType: "runtime-order-manifest",
    version: RUNTIME_METADATA_VERSION,
    orders: Object.fromEntries(RUNTIME_ORDERED_COLLECTIONS.map((collection) => [
      collection,
      (state[collection] ?? []).map((record) => record.id)
    ])) as Record<RuntimeOrderedCollection, string[]>
  };
  return [
    makeRuntimeSetting(RUNTIME_APP_METADATA_KEY, metadata as unknown as JsonValue, updatedAt),
    makeRuntimeSetting(RUNTIME_ORDER_MANIFEST_KEY, manifest as unknown as JsonValue, updatedAt)
  ];
}

export function parseRuntimeAppMetadata(setting: StoredSetting | undefined): RuntimeMetadataValidationResult<RuntimeAppMetadataValue> {
  if (!setting) return { valid: false, reason: "missing" };
  const value = setting.value;
  if (!isPlainRecord(value)) return { valid: false, reason: "invalid" };
  if (value.recordType !== "runtime-app-metadata" || value.version !== RUNTIME_METADATA_VERSION) {
    return { valid: false, reason: value.version === undefined ? "invalid" : "unsupported" };
  }
  if (!Number.isInteger(value.appSchemaVersion) || Number(value.appSchemaVersion) < 1 || !isValidUser(value.user)) {
    return { valid: false, reason: "invalid" };
  }
  return {
    valid: true,
    value: {
      recordType: "runtime-app-metadata",
      version: RUNTIME_METADATA_VERSION,
      appSchemaVersion: Number(value.appSchemaVersion),
      user: cloneUser(value.user)
    }
  };
}

export function parseRuntimeOrderManifest(setting: StoredSetting | undefined): RuntimeMetadataValidationResult<RuntimeOrderManifestValue> {
  if (!setting) return { valid: false, reason: "missing" };
  const value = setting.value;
  if (!isPlainRecord(value)) return { valid: false, reason: "invalid" };
  if (value.recordType !== "runtime-order-manifest" || value.version !== RUNTIME_METADATA_VERSION) {
    return { valid: false, reason: value.version === undefined ? "invalid" : "unsupported" };
  }
  if (!isPlainRecord(value.orders)) return { valid: false, reason: "invalid" };
  const orders = {} as Record<RuntimeOrderedCollection, string[]>;
  for (const collection of RUNTIME_ORDERED_COLLECTIONS) {
    const ids = value.orders[collection];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
      return { valid: false, reason: "invalid" };
    }
    orders[collection] = [...ids];
  }
  return {
    valid: true,
    value: { recordType: "runtime-order-manifest", version: RUNTIME_METADATA_VERSION, orders }
  };
}

function makeRuntimeSetting(key: string, value: JsonValue, updatedAt: string): StoredSetting {
  return {
    id: `setting-${key}`,
    key,
    value,
    category: "internal",
    internal: true,
    updatedAt,
    schemaVersion: RUNTIME_METADATA_VERSION
  };
}

function isValidUser(value: unknown): value is User {
  if (!isPlainRecord(value)) return false;
  return ["id", "name", "email", "createdAt"].every((key) => typeof value[key] === "string" && value[key].length > 0)
    && !Number.isNaN(Date.parse(String(value.createdAt)));
}

function cloneUser(user: User): User {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
