import { expect, test } from "@playwright/test";
import { StorageWriteGate } from "@revival/storage-runtime";
import type {
  ActiveStorageRuntime,
  StorageRuntimeHealthReport,
  StorageRuntimeLoadResult,
  StorageRuntimePersistResult,
  StorageRuntimeProductSettings,
} from "@revival/storage-runtime";
import type { AppState } from "@revival/shared-types";
import { createInitialDemoData } from "@revival/database";
import { appBootReducer, initialAppBootState } from "../../src/runtime/app-boot-state";
import { RuntimePersistCoordinator, type RuntimePersistStatus } from "../../src/runtime/runtime-persist-coordinator";

function healthReport(ok = true): StorageRuntimeHealthReport {
  return { ok, kind: "localStorage", schemaVersion: 3, issues: [], checkedAt: "2026-07-18T00:00:00.000Z" };
}

function loadResult(): StorageRuntimeLoadResult {
  return {
    state: createInitialDemoData(),
    settings: { themeId: "sprout", achievements: {} },
    runtimeKind: "localStorage",
    loadedAt: "2026-07-18T00:00:00.000Z",
    sourceSchemaVersion: 3,
    warnings: []
  };
}

class CoordinatorRuntime implements ActiveStorageRuntime {
  readonly kind = "localStorage" as const;
  readonly capabilities = {
    asynchronousLoad: true,
    transactionalWrites: false,
    entityDiffWrites: false,
    indexedQueries: false,
    persistent: true
  };
  lifecycle = "ready" as const;
  calls: string[] = [];
  failNext = false;

  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async healthCheck(): Promise<StorageRuntimeHealthReport> { return healthReport(); }
  async loadAppState(): Promise<StorageRuntimeLoadResult> { return loadResult(); }

  async persistAppState(_previous: AppState, next: AppState): Promise<StorageRuntimePersistResult> {
    await Promise.resolve();
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error("safe failure"), { code: "RUNTIME_PERSIST_FAILED" });
    }
    this.calls.push(`state:${next.searchLogs.length}`);
    return { runtimeKind: this.kind, persistedAt: "2026-07-18T00:00:00.000Z", changed: true, warnings: [] };
  }

  async persistProductSettings(
    _previous: StorageRuntimeProductSettings,
    next: StorageRuntimeProductSettings
  ): Promise<StorageRuntimePersistResult> {
    await Promise.resolve();
    this.calls.push(`theme:${next.themeId}`);
    return { runtimeKind: this.kind, persistedAt: "2026-07-18T00:00:00.000Z", changed: true, warnings: [] };
  }
}

test.describe("Task 8A boot state and persist coordinator", () => {
  test("boot reducer keeps persistence disabled until ready", () => {
    let state = appBootReducer(initialAppBootState, { type: "phase", status: "opening_runtime" });
    expect(state).toEqual({ status: "opening_runtime", persistEnabled: false });
    state = appBootReducer(state, { type: "phase", status: "checking_runtime" });
    expect(state.persistEnabled).toBe(false);
    state = appBootReducer(state, { type: "phase", status: "loading_state" });
    expect(state.persistEnabled).toBe(false);
    state = appBootReducer(state, { type: "ready", healthReport: healthReport(), loadResult: loadResult() });
    expect(state.status).toBe("ready");
    expect(state.persistEnabled).toBe(true);
  });

  test("degraded and failed are single non-persisting states", () => {
    const degraded = appBootReducer(initialAppBootState, {
      type: "degraded",
      healthReport: healthReport(false),
      loadResult: loadResult()
    });
    expect(degraded.status).toBe("degraded");
    expect(degraded.persistEnabled).toBe(false);
    const failed = appBootReducer(degraded, { type: "failed", code: "RUNTIME_LOAD_FAILED" });
    expect(failed).toEqual({ status: "failed", safeErrorCode: "RUNTIME_LOAD_FAILED", persistEnabled: false });
  });

  test("coordinator serializes AppState and product-setting writes", async () => {
    const runtime = new CoordinatorRuntime();
    const statuses: RuntimePersistStatus[] = [];
    const coordinator = new RuntimePersistCoordinator(runtime, (status) => statuses.push(status));
    const first = createInitialDemoData();
    const second = { ...first, searchLogs: [{ id: "one", userId: "user", query: "one", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }] };
    await Promise.all([
      coordinator.enqueueAppState(first, second),
      coordinator.enqueueProductSettings(
        { themeId: "sprout", achievements: {} },
        { themeId: "dawn", achievements: {} }
      )
    ]);
    expect(runtime.calls).toEqual(["state:1", "theme:dawn"]);
    expect(statuses.filter((status) => status.status === "saving")).toHaveLength(2);
    expect(statuses.at(-1)?.status).toBe("saved");
  });

  test("a failed write is reported and does not poison the queue", async () => {
    const runtime = new CoordinatorRuntime();
    runtime.failNext = true;
    const statuses: RuntimePersistStatus[] = [];
    const coordinator = new RuntimePersistCoordinator(runtime, (status) => statuses.push(status));
    const first = createInitialDemoData();
    const second = { ...first, searchLogs: [{ id: "one", userId: "user", query: "one", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }] };
    await expect(coordinator.enqueueAppState(first, second)).rejects.toThrow("safe failure");
    await coordinator.enqueueProductSettings(
      { themeId: "sprout", achievements: {} },
      { themeId: "mist-blue", achievements: {} }
    );
    expect(statuses.some((status) => status.status === "failed" && status.code === "RUNTIME_PERSIST_FAILED")).toBe(true);
    expect(runtime.calls).toEqual(["theme:mist-blue"]);
  });

  test("disposed coordinator completes queued writes without updating React state", async () => {
    const runtime = new CoordinatorRuntime();
    const statuses: RuntimePersistStatus[] = [];
    const coordinator = new RuntimePersistCoordinator(runtime, (status) => statuses.push(status));
    const first = createInitialDemoData();
    const second = { ...first, searchLogs: [{ id: "one", userId: "user", query: "one", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }] };
    const pending = coordinator.enqueueAppState(first, second);
    coordinator.dispose();
    await pending;
    await coordinator.flush();
    expect(runtime.calls).toEqual(["state:1"]);
    expect(statuses).toEqual([]);
  });

  test("activation write gate flushes queued writes before freezing and blocks later state or setting writes", async () => {
    const runtime = new CoordinatorRuntime();
    const gate = new StorageWriteGate();
    const coordinator = new RuntimePersistCoordinator(runtime, () => undefined, gate);
    const first = createInitialDemoData();
    const second = { ...first, searchLogs: [{ id: "one", userId: "user", query: "one", resultCount: 1, createdAt: "2026-07-18T00:00:00.000Z" }] };
    const pending = coordinator.enqueueAppState(first, second);
    await coordinator.freezeForActivationPreflight();
    await pending;
    expect(runtime.calls).toEqual(["state:1"]);
    expect(gate.state).toBe("activation_preflight");
    await expect(coordinator.enqueueProductSettings({ themeId: "sprout", achievements: {} }, { themeId: "dawn", achievements: {} })).rejects.toMatchObject({ code: "ACTIVATION_WRITE_GATE_FAILED" });
    expect(runtime.calls).toEqual(["state:1"]);
  });

  test("activation cancellation reopens the existing persist coordinator", async () => {
    const runtime = new CoordinatorRuntime();
    const gate = new StorageWriteGate("activation_prepared");
    const coordinator = new RuntimePersistCoordinator(runtime, () => undefined, gate);
    await expect(coordinator.enqueueProductSettings({ themeId: "sprout", achievements: {} }, { themeId: "dawn", achievements: {} })).rejects.toMatchObject({ code: "ACTIVATION_WRITE_GATE_FAILED" });
    gate.reopen();
    await coordinator.enqueueProductSettings({ themeId: "sprout", achievements: {} }, { themeId: "dawn", achievements: {} });
    expect(runtime.calls).toEqual(["theme:dawn"]);
  });
});
