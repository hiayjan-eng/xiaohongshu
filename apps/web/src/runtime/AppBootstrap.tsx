import { useEffect, useReducer, useRef, useState } from "react";
import {
  LocalStorageRuntime,
  StorageBootstrapMarkerStore,
  StorageRuntimeError,
  StorageWriteGate,
  createBrowserStorageRuntimeBroadcast,
  type ActiveStorageRuntime
} from "@revival/storage-runtime";
import { AppContent } from "../App";
import { AppBootScreen } from "./AppBootScreen";
import { appBootReducer, initialAppBootState } from "./app-boot-state";
import { MigrationRouteShell } from "./MigrationRouteShell";

type AppBootstrapProps = {
  runtimeFactory?: () => ActiveStorageRuntime;
};

export function AppBootstrap({ runtimeFactory = createDefaultRuntime }: AppBootstrapProps) {
  if (isDirectMigrationRoute()) {
    return <MigrationRouteShell />;
  }

  return <StorageMarkerBootstrap runtimeFactory={runtimeFactory} />;
}

type MarkerBootState = "checking" | "legacy" | "activation_prepared" | "recovery_required";

function StorageMarkerBootstrap({ runtimeFactory }: Required<AppBootstrapProps>) {
  const [markerState, setMarkerState] = useState<MarkerBootState>("checking");
  const [writeGate] = useState(() => new StorageWriteGate());

  useEffect(() => {
    let active = true;
    const readMarker = async () => {
      const result = await new StorageBootstrapMarkerStore(window.localStorage).read();
      if (!active) return;
      if (result.status === "missing" || (result.status === "valid" && result.marker.state === "legacy_active")) {
        writeGate.reopen();
        setMarkerState("legacy");
      } else if (result.status === "valid" && result.marker.state === "activation_prepared") {
        writeGate.markPrepared();
        setMarkerState("activation_prepared");
      } else {
        writeGate.markPrepared();
        setMarkerState("recovery_required");
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "collection-revival-storage-bootstrap:v1") void readMarker();
    };
    const broadcast = createBrowserStorageRuntimeBroadcast();
    const unsubscribe = broadcast.subscribe((message) => {
      if (message.type === "activation_prepared") {
        writeGate.markPrepared();
        setMarkerState("activation_prepared");
      } else if (message.type === "activation_prepare_cancelled") {
        writeGate.reopen();
        setMarkerState("legacy");
      } else {
        writeGate.enterPreflight();
      }
    });
    window.addEventListener("storage", onStorage);
    void readMarker();
    return () => {
      active = false;
      unsubscribe();
      broadcast.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [writeGate]);

  if (markerState === "checking") return <AppBootScreen mode="loading" />;
  if (markerState === "activation_prepared") return <AppBootScreen mode="activation_prepared" onOpenDataManagement={() => navigateTo("/settings/data-migration")} />;
  if (markerState === "recovery_required") return <AppBootScreen mode="storage_recovery_required" onOpenDataManagement={() => navigateTo("/settings/data-migration")} />;
  return <RuntimeAppBootstrap runtimeFactory={runtimeFactory} writeGate={writeGate} />;
}

function RuntimeAppBootstrap({ runtimeFactory, writeGate }: Required<AppBootstrapProps> & { writeGate: StorageWriteGate }) {
  const [runtime] = useState(runtimeFactory);
  const [boot, dispatch] = useReducer(appBootReducer, initialAppBootState);
  const [retryVersion, setRetryVersion] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;
    const isCurrent = () => active && generationRef.current === generation;

    void (async () => {
      try {
        if (retryVersion > 0) await runtime.close();
        if (!isCurrent()) return;
        dispatch({ type: "phase", status: "opening_runtime" });
        await waitForRuntimeTestGate();
        if (!isCurrent()) return;
        await runtime.open();
        if (!isCurrent()) return;
        dispatch({ type: "phase", status: "checking_runtime" });
        const healthReport = await runtime.healthCheck();
        if (!isCurrent()) return;
        dispatch({ type: "phase", status: "loading_state" });
        const loadResult = await runtime.loadAppState();
        if (!isCurrent()) return;
        const blocked = !healthReport.ok || loadResult.warnings.some((warning) => warning.blocking);
        if (blocked) dispatch({ type: "degraded", healthReport, loadResult });
        else dispatch({ type: "ready", healthReport, loadResult });
      } catch (error) {
        if (!isCurrent()) return;
        const code = error instanceof StorageRuntimeError ? error.code : "RUNTIME_LOAD_FAILED";
        dispatch({ type: "failed", code });
      }
    })();

    return () => {
      active = false;
      queueMicrotask(() => {
        if (generationRef.current === generation) void runtime.close();
      });
    };
  }, [retryVersion, runtime]);

  if (boot.status === "ready" && boot.loadResult) {
    return (
      <AppContent
        initialState={boot.loadResult.state}
        initialSettings={boot.loadResult.settings}
        runtime={runtime}
        writeGate={writeGate}
      />
    );
  }

  if (boot.status === "degraded") {
    return (
      <AppBootScreen
        mode="degraded"
        issues={[...(boot.healthReport?.issues ?? []), ...(boot.loadResult?.warnings ?? [])]}
        onRetry={() => setRetryVersion((value) => value + 1)}
        onOpenDataManagement={() => navigateTo("/settings/data-migration")}
      />
    );
  }

  if (boot.status === "failed") {
    return (
      <AppBootScreen
        mode="failed"
        errorCode={boot.safeErrorCode}
        onRetry={() => setRetryVersion((value) => value + 1)}
        onOpenDataManagement={() => navigateTo("/settings/data-migration")}
      />
    );
  }

  return <AppBootScreen mode="loading" />;
}

function createDefaultRuntime(): ActiveStorageRuntime {
  return new LocalStorageRuntime({ storage: window.localStorage });
}

function isDirectMigrationRoute(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/settings/data-migration";
}

function navigateTo(path: string): void {
  window.location.assign(path);
}

async function waitForRuntimeTestGate(): Promise<void> {
  const gate = (window as typeof window & { __REVIVAL_RUNTIME_BOOT_GATE__?: Promise<void> }).__REVIVAL_RUNTIME_BOOT_GATE__;
  if (gate) await gate;
}
