import type { AppState } from "@revival/shared-types";

export type StorageRuntimeKind = "localStorage" | "indexedDB";

export type StorageRuntimeLifecycle =
  | "closed"
  | "opening"
  | "open"
  | "loading"
  | "ready"
  | "persisting"
  | "degraded"
  | "failed";

export interface StorageRuntimeCapabilities {
  asynchronousLoad: boolean;
  transactionalWrites: boolean;
  entityDiffWrites: boolean;
  indexedQueries: boolean;
  persistent: boolean;
}

export type StorageRuntimeWarningCode =
  | "RUNTIME_DATA_MISSING"
  | "RUNTIME_JSON_INVALID"
  | "RUNTIME_DATA_INVALID"
  | "RUNTIME_SCHEMA_UNSUPPORTED"
  | "RUNTIME_SETTING_INVALID";

export interface StorageRuntimeWarning {
  code: StorageRuntimeWarningCode;
  blocking: boolean;
  setting?: "theme" | "achievements";
}

export interface StorageRuntimeHealthIssue {
  code: StorageRuntimeWarningCode | "RUNTIME_UNAVAILABLE";
  blocking: boolean;
  setting?: "theme" | "achievements";
}

export interface StorageRuntimeHealthReport {
  ok: boolean;
  kind: StorageRuntimeKind;
  schemaVersion?: number;
  issues: StorageRuntimeHealthIssue[];
  checkedAt: string;
}

export interface StorageRuntimeProductSettings {
  themeId: string;
  achievements: Record<string, string>;
}

export interface StorageRuntimeLoadResult {
  state: AppState;
  settings: StorageRuntimeProductSettings;
  runtimeKind: StorageRuntimeKind;
  loadedAt: string;
  sourceSchemaVersion?: number;
  warnings: StorageRuntimeWarning[];
}

export interface StorageRuntimePersistResult {
  runtimeKind: StorageRuntimeKind;
  persistedAt: string;
  changed: boolean;
  warnings: StorageRuntimeWarning[];
}

export interface RuntimeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ActiveStorageRuntime {
  readonly kind: StorageRuntimeKind;
  readonly capabilities: StorageRuntimeCapabilities;
  readonly lifecycle: StorageRuntimeLifecycle;

  open(): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<StorageRuntimeHealthReport>;
  loadAppState(): Promise<StorageRuntimeLoadResult>;
  persistAppState(previous: AppState, next: AppState): Promise<StorageRuntimePersistResult>;
  persistProductSettings(
    previous: StorageRuntimeProductSettings,
    next: StorageRuntimeProductSettings
  ): Promise<StorageRuntimePersistResult>;
}
