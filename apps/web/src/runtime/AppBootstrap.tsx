import { useEffect, useReducer, useRef, useState } from "react";
import {
  LocalStorageRuntime,
  StorageBootstrapMarkerStore,
  StorageRuntimeError,
  StorageWriteGate,
  createBrowserStorageRuntimeBroadcast,
  selectStorageRuntime,
  type ActiveStorageRuntime,
  type ActivationBootReadyResult,
  type ActivationBootStage,
  type SafeActivationRecoveryReport,
  type StorageRuntimeSelection
} from "@revival/storage-runtime";
import { AppContent } from "../App";
import { AppBootScreen } from "./AppBootScreen";
import { appBootReducer, initialAppBootState } from "./app-boot-state";
import { BrowserActivationRecoveryController } from "./activation-recovery-controller";
import { MigrationRouteShell } from "./MigrationRouteShell";
import { StorageRecoveryScreen } from "./StorageRecoveryScreen";

type AppBootstrapProps = { runtimeFactory?: () => ActiveStorageRuntime };

export function AppBootstrap({ runtimeFactory = createDefaultRuntime }: AppBootstrapProps) {
  return isDirectMigrationRoute()
    ? <MigrationRouteBootstrap runtimeFactory={runtimeFactory} />
    : <StorageMarkerBootstrap runtimeFactory={runtimeFactory} />;
}

function MigrationRouteBootstrap({ runtimeFactory }: Required<AppBootstrapProps>) {
  const [selection, setSelection] = useState<StorageRuntimeSelection>();
  useEffect(() => {
    let active = true;
    void new StorageBootstrapMarkerStore(window.localStorage).read().then((marker) => {
      if (active) setSelection(selectStorageRuntime(marker));
    });
    return () => { active = false; };
  }, []);
  if (!selection) return <AppBootScreen mode="loading" />;
  if (selection.mode === "legacy" || selection.mode === "activation_prepared") return <MigrationRouteShell />;
  return <StorageMarkerBootstrap runtimeFactory={runtimeFactory} />;
}

function StorageMarkerBootstrap({ runtimeFactory }: Required<AppBootstrapProps>) {
  const [selection, setSelection] = useState<StorageRuntimeSelection>();
  const [writeGate] = useState(() => new StorageWriteGate());
  const [reloadRequired, setReloadRequired] = useState(false);
  const selectionRef = useRef<StorageRuntimeSelection | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const readMarker = async () => {
      const marker = await new StorageBootstrapMarkerStore(window.localStorage).read();
      if (!active) return;
      const next = selectStorageRuntime(marker);
      if (next.mode === "legacy") writeGate.reopen();
      else if (next.mode === "activation_prepared") writeGate.markPrepared();
      else writeGate.markSwitching();
      const current = selectionRef.current;
      if (current?.mode === "legacy" && next.mode === "activation_prepared") return;
      if ((current?.mode === "legacy" || current?.mode === "activation_prepared") &&
          (next.mode === "activation_boot" || next.mode === "indexeddb_active")) {
        setReloadRequired(true);
        return;
      }
      selectionRef.current = next;
      setReloadRequired(false);
      setSelection(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "collection-revival-storage-bootstrap:v1") void readMarker();
    };
    const broadcast = createBrowserStorageRuntimeBroadcast();
    const unsubscribe = broadcast.subscribe((message) => {
      if (message.type === "activation_preflight_started") writeGate.enterPreflight();
      if (message.type === "activation_prepared") writeGate.markPrepared();
      if (message.type === "storage_activation_started" || message.type === "storage_backend_activated") writeGate.markSwitching();
      void readMarker();
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

  if (!selection) return <AppBootScreen mode="loading" />;
  if (reloadRequired) return <AppBootScreen mode="activation_switching" onReload={() => window.location.reload()} />;
  if (selection.mode === "legacy") return <RuntimeAppBootstrap runtimeFactory={runtimeFactory} writeGate={writeGate} />;
  if (selection.mode === "activation_prepared") {
    return <AppBootScreen mode="activation_prepared" onOpenDataManagement={() => navigateTo("/settings/data-migration")} />;
  }
  if (selection.mode === "activation_boot" || selection.mode === "indexeddb_active") {
    return <IndexedDbRuntimeBootstrap initialSelection={selection} />;
  }
  return <RecoveryOnlyBootstrap safeErrorCode={selection.safeErrorCode} />;
}

function IndexedDbRuntimeBootstrap({ initialSelection }: { initialSelection: StorageRuntimeSelection }) {
  const controllerRef = useRef<BrowserActivationRecoveryController | undefined>(undefined);
  const lifecycleGenerationRef = useRef(0);
  const [ready, setReady] = useState<ActivationBootReadyResult>();
  const [stage, setStage] = useState<ActivationBootStage>(initialSelection.mode === "indexeddb_active" ? "boot_opening_indexeddb" : "boot_verifying");
  const [report, setReport] = useState<SafeActivationRecoveryReport>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(true);

  function controller(): BrowserActivationRecoveryController {
    return controllerRef.current ?? (controllerRef.current = new BrowserActivationRecoveryController());
  }

  async function runBoot() {
    setBusy(true);
    setActionError(undefined);
    setReport(undefined);
    try {
      const result = await controller().boot(setStage);
      setReady(result);
    } catch (error) {
      const code = safeCode(error);
      setActionError(code);
      setReport(await controller().inspect(code));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;
    void runBoot();
    return () => {
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === generation) void controllerRef.current?.close();
      });
    };
  }, []);

  if (ready) {
    return <AppContent initialState={ready.loadResult.state} initialSettings={ready.loadResult.settings} runtime={ready.runtime} writeGate={controller().writeGate} activatedAt={ready.marker.activatedAt} />;
  }
  if (!report) return <ActivationBootProgressScreen stage={stage} />;
  return <RecoveryView controller={controller()} report={report} busy={busy} actionError={actionError} onReady={setReady} onReport={setReport} onError={setActionError} />;
}

function RecoveryOnlyBootstrap({ safeErrorCode }: { safeErrorCode?: string }) {
  const controllerRef = useRef<BrowserActivationRecoveryController | undefined>(undefined);
  const lifecycleGenerationRef = useRef(0);
  const [report, setReport] = useState<SafeActivationRecoveryReport>();
  const [actionError, setActionError] = useState<string>();
  const [ready, setReady] = useState<ActivationBootReadyResult>();
  const [busy, setBusy] = useState(true);
  const controller = controllerRef.current ?? (controllerRef.current = new BrowserActivationRecoveryController());
  useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;
    void controller.inspect(safeErrorCode).then(setReport).catch((error) => setActionError(safeCode(error))).finally(() => setBusy(false));
    return () => {
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === generation) void controller.close();
      });
    };
  }, [controller, safeErrorCode]);
  if (ready) return <AppContent initialState={ready.loadResult.state} initialSettings={ready.loadResult.settings} runtime={ready.runtime} writeGate={controller.writeGate} activatedAt={ready.marker.activatedAt} />;
  return <RecoveryView controller={controller} report={report} busy={busy} actionError={actionError} onReady={setReady} onReport={setReport} onError={setActionError} />;
}

function RecoveryView(props: {
  controller: BrowserActivationRecoveryController;
  report?: SafeActivationRecoveryReport;
  busy: boolean;
  actionError?: string;
  onReady: (result: ActivationBootReadyResult) => void;
  onReport: (report: SafeActivationRecoveryReport) => void;
  onError: (code?: string) => void;
}) {
  async function refresh() {
    props.onError(undefined);
    try { props.onReport(await props.controller.inspect()); } catch (error) { props.onError(safeCode(error)); }
  }
  async function retry() {
    props.onError(undefined);
    try { props.onReady(await props.controller.boot()); } catch (error) { props.onError(safeCode(error)); props.onReport(await props.controller.inspect(safeCode(error))); }
  }
  async function cancel() {
    if (!props.report || !window.confirm("只允许在正式提交前取消。系统会重新验证旧数据完整性，并保留 IndexedDB、备份和迁移记录。继续吗？")) return;
    try { await props.controller.cancelUncommittedActivation(props.report, true); window.location.reload(); } catch (error) { props.onError(safeCode(error)); }
  }
  async function finalize() {
    if (!props.report) return;
    try { await props.controller.finalizeCommittedMarker(props.report); window.location.reload(); } catch (error) { props.onError(safeCode(error)); }
  }
  return (
    <StorageRecoveryScreen
      report={props.report}
      loading={props.busy}
      actionError={props.actionError}
      onRefresh={refresh}
      onRetryBoot={retry}
      onCancelUncommitted={cancel}
      onFinalizeMarker={finalize}
      onLegacyBackup={() => props.controller.prepareLegacyBackupDownload(props.report!)}
      onIndexedDbSnapshot={() => props.controller.prepareIndexedDbSnapshotDownload()}
      onSafeReport={() => props.controller.prepareSafeReportDownload(props.report!)}
    />
  );
}

function ActivationBootProgressScreen({ stage }: { stage: ActivationBootStage }) {
  const labels: Record<ActivationBootStage, string> = {
    boot_opening_indexeddb: "正在打开 IndexedDB",
    boot_health_check: "正在检查新存储健康状态",
    boot_hydrating: "正在读取收藏和设置",
    boot_verifying: "正在验证完整性",
    committing_activation: "正在提交正式启用",
    finalizing_marker: "正在完成启动标记",
    indexeddb_active: "IndexedDB 已启用"
  };
  return (
    <main className="app-boot-screen" data-testid={`activation-boot-${stage}`} aria-live="polite">
      <section className="app-boot-panel"><p className="app-boot-kicker">存储启动验证</p><h1>{labels[stage]}</h1><p>验证完成前不会打开普通收藏页面，也不会写入旧 localStorage。</p><div className="app-boot-progress" aria-hidden="true"><span /></div></section>
    </main>
  );
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
        dispatch({ type: "failed", code: error instanceof StorageRuntimeError ? error.code : "RUNTIME_LOAD_FAILED" });
      }
    })();
    return () => {
      active = false;
      queueMicrotask(() => { if (generationRef.current === generation) void runtime.close(); });
    };
  }, [retryVersion, runtime]);

  if (boot.status === "ready" && boot.loadResult) return <AppContent initialState={boot.loadResult.state} initialSettings={boot.loadResult.settings} runtime={runtime} writeGate={writeGate} />;
  if (boot.status === "degraded") return <AppBootScreen mode="degraded" issues={[...(boot.healthReport?.issues ?? []), ...(boot.loadResult?.warnings ?? [])]} onRetry={() => setRetryVersion((value) => value + 1)} onOpenDataManagement={() => navigateTo("/settings/data-migration")} />;
  if (boot.status === "failed") return <AppBootScreen mode="failed" errorCode={boot.safeErrorCode} onRetry={() => setRetryVersion((value) => value + 1)} onOpenDataManagement={() => navigateTo("/settings/data-migration")} />;
  return <AppBootScreen mode="loading" />;
}

function createDefaultRuntime(): ActiveStorageRuntime { return new LocalStorageRuntime({ storage: window.localStorage }); }
function isDirectMigrationRoute(): boolean { return typeof window !== "undefined" && window.location.pathname === "/settings/data-migration"; }
function navigateTo(path: string): void { window.location.assign(path); }
function safeCode(error: unknown): string { return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "ACTIVATION_RUNTIME_SELECTION_FAILED"; }
async function waitForRuntimeTestGate(): Promise<void> {
  const gate = (window as typeof window & { __REVIVAL_RUNTIME_BOOT_GATE__?: Promise<void> }).__REVIVAL_RUNTIME_BOOT_GATE__;
  if (gate) await gate;
}