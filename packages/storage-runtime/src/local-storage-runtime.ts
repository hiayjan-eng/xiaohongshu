import {
  APP_SCHEMA_VERSION,
  type AppState
} from "@revival/shared-types";
import {
  createInitialDemoData,
  persistAppState as persistLegacyAppState,
  readLegacyAppState,
  STORAGE_KEY
} from "@revival/database";
import type {
  ActiveStorageRuntime,
  RuntimeStorageLike,
  StorageRuntimeCapabilities,
  StorageRuntimeHealthIssue,
  StorageRuntimeHealthReport,
  StorageRuntimeLifecycle,
  StorageRuntimeLoadResult,
  StorageRuntimePersistResult,
  StorageRuntimeProductSettings,
  StorageRuntimeWarning
} from "./contracts";
import { StorageRuntimeError } from "./errors";

export const RUNTIME_THEME_STORAGE_KEY = "collection-revival-theme";
export const RUNTIME_ACHIEVEMENTS_STORAGE_KEY = "collection-revival-achievements";
export const DEFAULT_RUNTIME_THEME_ID = "sprout";

type LocalStorageRuntimeOptions = {
  storage: RuntimeStorageLike;
  now?: () => Date;
};

export class LocalStorageRuntime implements ActiveStorageRuntime {
  readonly kind = "localStorage" as const;
  readonly capabilities: StorageRuntimeCapabilities = Object.freeze({
    asynchronousLoad: true,
    transactionalWrites: false,
    entityDiffWrites: false,
    indexedQueries: false,
    persistent: true
  });

  private state: StorageRuntimeLifecycle = "closed";
  private loadPromise?: Promise<StorageRuntimeLoadResult>;
  private loadedResult?: StorageRuntimeLoadResult;
  private persistTail: Promise<unknown> = Promise.resolve();
  private hasUsableState = false;
  private readonly storage: RuntimeStorageLike;
  private readonly now: () => Date;

  constructor(options: LocalStorageRuntimeOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
  }

  get lifecycle(): StorageRuntimeLifecycle {
    return this.state;
  }

  async open(): Promise<void> {
    if (this.state !== "closed") return;
    this.state = "opening";
    this.state = "open";
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    await this.persistTail.catch(() => undefined);
    this.state = "closed";
    this.loadPromise = undefined;
    this.loadedResult = undefined;
    this.hasUsableState = false;
  }

  async healthCheck(): Promise<StorageRuntimeHealthReport> {
    this.ensureOpen("RUNTIME_NOT_OPEN");
    const issues: StorageRuntimeHealthIssue[] = [];
    let sourceSchemaVersion: number | undefined;

    try {
      const inspection = readLegacyAppState(this.storage);
      sourceSchemaVersion = inspection.sourceSchemaVersion;
      if (inspection.status === "invalid_json") issues.push({ code: "RUNTIME_JSON_INVALID", blocking: true });
      if (inspection.status === "invalid_data") issues.push({ code: "RUNTIME_DATA_INVALID", blocking: true });
      if (inspection.status === "unsupported_schema") issues.push({ code: "RUNTIME_SCHEMA_UNSUPPORTED", blocking: true });
      this.readSettings(issues);
    } catch (cause) {
      issues.push({ code: "RUNTIME_UNAVAILABLE", blocking: true });
      return {
        ok: false,
        kind: this.kind,
        schemaVersion: sourceSchemaVersion,
        issues,
        checkedAt: this.now().toISOString()
      };
    }

    return {
      ok: !issues.some((issue) => issue.blocking),
      kind: this.kind,
      schemaVersion: sourceSchemaVersion ?? APP_SCHEMA_VERSION,
      issues,
      checkedAt: this.now().toISOString()
    };
  }

  async loadAppState(): Promise<StorageRuntimeLoadResult> {
    this.ensureOpen("RUNTIME_NOT_OPEN");
    if (this.loadedResult) return clone(this.loadedResult);
    if (this.loadPromise) return clone(await this.loadPromise);

    this.loadPromise = this.performLoad();
    try {
      const result = await this.loadPromise;
      this.loadedResult = result;
      return clone(result);
    } finally {
      this.loadPromise = undefined;
    }
  }

  async persistAppState(previous: AppState, next: AppState): Promise<StorageRuntimePersistResult> {
    return this.enqueuePersist(async () => {
      this.ensurePersistable();
      const previousSerialized = JSON.stringify(previous);
      const nextSerialized = JSON.stringify(next);
      if (previousSerialized === nextSerialized) return this.persistResult(false);

      try {
        persistLegacyAppState(next, this.storage);
        return this.persistResult(true);
      } catch (cause) {
        this.state = "degraded";
        throw this.error("RUNTIME_PERSIST_FAILED", true, cause);
      }
    });
  }

  async persistProductSettings(
    previous: StorageRuntimeProductSettings,
    next: StorageRuntimeProductSettings
  ): Promise<StorageRuntimePersistResult> {
    return this.enqueuePersist(async () => {
      this.ensurePersistable();
      const themeChanged = previous.themeId !== next.themeId;
      const achievementsChanged = JSON.stringify(previous.achievements) !== JSON.stringify(next.achievements);
      if (!themeChanged && !achievementsChanged) return this.persistResult(false);

      try {
        if (themeChanged) this.storage.setItem(RUNTIME_THEME_STORAGE_KEY, next.themeId);
        if (achievementsChanged) {
          this.storage.setItem(RUNTIME_ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(next.achievements));
        }
        return this.persistResult(true);
      } catch (cause) {
        this.state = "degraded";
        throw this.error("RUNTIME_PERSIST_FAILED", true, cause);
      }
    });
  }

  private async performLoad(): Promise<StorageRuntimeLoadResult> {
    this.state = "loading";
    try {
      const inspection = readLegacyAppState(this.storage);
      const settingWarnings: StorageRuntimeWarning[] = [];
      const settings = this.readSettings(settingWarnings);
      const warnings: StorageRuntimeWarning[] = [...settingWarnings];
      let state: AppState;

      switch (inspection.status) {
        case "loaded":
          state = inspection.state!;
          this.hasUsableState = true;
          this.state = "ready";
          break;
        case "missing":
          state = createInitialDemoData();
          warnings.push({ code: "RUNTIME_DATA_MISSING", blocking: false });
          this.hasUsableState = true;
          this.state = "ready";
          break;
        case "unsupported_schema":
          state = createInitialDemoData();
          warnings.push({ code: "RUNTIME_SCHEMA_UNSUPPORTED", blocking: true });
          this.state = "degraded";
          break;
        case "invalid_json":
          state = createInitialDemoData();
          warnings.push({ code: "RUNTIME_JSON_INVALID", blocking: true });
          this.state = "degraded";
          break;
        default:
          state = createInitialDemoData();
          warnings.push({ code: "RUNTIME_DATA_INVALID", blocking: true });
          this.state = "degraded";
      }

      return {
        state,
        settings,
        runtimeKind: this.kind,
        loadedAt: this.now().toISOString(),
        sourceSchemaVersion: inspection.sourceSchemaVersion,
        warnings
      };
    } catch (cause) {
      this.state = "failed";
      throw this.error("RUNTIME_LOAD_FAILED", true, cause);
    }
  }

  private readSettings(issues: Array<StorageRuntimeWarning | StorageRuntimeHealthIssue>): StorageRuntimeProductSettings {
    const themeId = this.storage.getItem(RUNTIME_THEME_STORAGE_KEY) || DEFAULT_RUNTIME_THEME_ID;
    const achievementsRaw = this.storage.getItem(RUNTIME_ACHIEVEMENTS_STORAGE_KEY);
    let achievements: Record<string, string> = {};
    if (achievementsRaw) {
      try {
        const parsed = JSON.parse(achievementsRaw) as unknown;
        if (!isStringRecord(parsed)) throw new Error("invalid setting");
        achievements = parsed;
      } catch {
        issues.push({ code: "RUNTIME_SETTING_INVALID", blocking: false, setting: "achievements" });
      }
    }
    return { themeId, achievements };
  }

  private enqueuePersist<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.persistTail.then(async () => {
      this.ensureOpen("RUNTIME_NOT_OPEN");
      this.state = "persisting";
      const result = await operation();
      this.state = "ready";
      return result;
    });
    this.persistTail = queued.catch(() => undefined);
    return queued;
  }

  private ensurePersistable(): void {
    if (!this.hasUsableState) throw this.error("RUNTIME_DATA_INVALID", false);
  }

  private ensureOpen(code: "RUNTIME_NOT_OPEN"): void {
    if (this.state === "closed") throw this.error(code, true);
  }

  private persistResult(changed: boolean): StorageRuntimePersistResult {
    return {
      runtimeKind: this.kind,
      persistedAt: this.now().toISOString(),
      changed,
      warnings: []
    };
  }

  private error(
    code: ConstructorParameters<typeof StorageRuntimeError>[0]["code"],
    recoverable: boolean,
    cause?: unknown
  ): StorageRuntimeError {
    return new StorageRuntimeError({
      code,
      runtimeKind: this.kind,
      lifecycle: this.state,
      recoverable,
      cause
    });
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}
