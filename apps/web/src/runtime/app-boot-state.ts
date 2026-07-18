import type { StorageRuntimeHealthReport, StorageRuntimeLoadResult } from "@revival/storage-runtime";

export type AppBootStatus =
  | "idle"
  | "opening_runtime"
  | "checking_runtime"
  | "loading_state"
  | "ready"
  | "degraded"
  | "failed";

export type AppBootState = {
  status: AppBootStatus;
  healthReport?: StorageRuntimeHealthReport;
  loadResult?: StorageRuntimeLoadResult;
  safeErrorCode?: string;
  persistEnabled: boolean;
};

export type AppBootAction =
  | { type: "phase"; status: "opening_runtime" | "checking_runtime" | "loading_state" }
  | { type: "ready"; healthReport: StorageRuntimeHealthReport; loadResult: StorageRuntimeLoadResult }
  | { type: "degraded"; healthReport: StorageRuntimeHealthReport; loadResult: StorageRuntimeLoadResult }
  | { type: "failed"; code: string };

export const initialAppBootState: AppBootState = {
  status: "idle",
  persistEnabled: false
};

export function appBootReducer(state: AppBootState, action: AppBootAction): AppBootState {
  switch (action.type) {
    case "phase":
      return { status: action.status, persistEnabled: false };
    case "ready":
      return {
        status: "ready",
        healthReport: action.healthReport,
        loadResult: action.loadResult,
        persistEnabled: true
      };
    case "degraded":
      return {
        status: "degraded",
        healthReport: action.healthReport,
        loadResult: action.loadResult,
        persistEnabled: false
      };
    case "failed":
      return { status: "failed", safeErrorCode: action.code, persistEnabled: false };
    default:
      return state;
  }
}
