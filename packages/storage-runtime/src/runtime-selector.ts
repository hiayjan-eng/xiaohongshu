import type { StorageBootstrapMarkerReadResult, StorageBootstrapMarkerV1 } from "./bootstrap-marker";

export type StorageRuntimeSelectionMode =
  | "legacy"
  | "activation_prepared"
  | "activation_boot"
  | "indexeddb_active"
  | "recovery_required";

export interface StorageRuntimeSelection {
  mode: StorageRuntimeSelectionMode;
  marker?: StorageBootstrapMarkerV1;
  safeErrorCode?: string;
}

export function selectStorageRuntime(markerRead: StorageBootstrapMarkerReadResult): StorageRuntimeSelection {
  if (markerRead.status === "missing") return { mode: "legacy" };
  if (markerRead.status === "invalid" || markerRead.status === "unsupported") {
    return { mode: "recovery_required", safeErrorCode: markerRead.errorCode };
  }
  const marker = markerRead.marker;
  switch (marker.state) {
    case "legacy_active":
      return marker.activeBackend === "localStorage"
        ? { mode: "legacy", marker }
        : { mode: "recovery_required", marker, safeErrorCode: "ACTIVATION_BACKEND_CONFLICT" };
    case "activation_prepared":
      return marker.activeBackend === "localStorage"
        ? { mode: "activation_prepared", marker }
        : { mode: "recovery_required", marker, safeErrorCode: "ACTIVATION_BACKEND_CONFLICT" };
    case "activating":
      return marker.activeBackend === "indexedDB"
        ? { mode: "activation_boot", marker }
        : { mode: "recovery_required", marker, safeErrorCode: "ACTIVATION_BACKEND_CONFLICT" };
    case "indexeddb_active":
      return marker.activeBackend === "indexedDB"
        ? { mode: "indexeddb_active", marker }
        : { mode: "recovery_required", marker, safeErrorCode: "ACTIVATION_BACKEND_CONFLICT" };
    default:
      return { mode: "recovery_required", marker, safeErrorCode: marker.errorCode ?? "ACTIVATION_RUNTIME_SELECTION_FAILED" };
  }
}