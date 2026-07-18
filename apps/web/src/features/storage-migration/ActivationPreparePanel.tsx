import { AlertTriangle, CheckCircle2, Download, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo, useReducer, useRef } from "react";
import type {
  ActivationConfirmationValues,
  ActivationPreflightReport,
  ActivationPrepareConfirmations,
  ActivationPrepareStage,
  ActivationSwitchStage
} from "@revival/storage-runtime";
import { ActivationPrepareController } from "./activation-prepare-controller";
import { triggerPreparedBackupDownload } from "./MigrationBackupStep";

type Status =
  | "idle" | "checking" | "eligible" | "blocked" | "confirming" | "preparing" | "prepared"
  | "cancelling" | "another_tab_active" | "error" | "awaiting_activation_confirmation"
  | "acquiring_activation_lock" | "final_rechecking" | "writing_switch_journal"
  | "writing_activating_marker" | "reloading";

type State = {
  status: Status;
  report?: ActivationPreflightReport;
  stage?: ActivationPrepareStage | ActivationSwitchStage;
  prepareConfirmations: ActivationPrepareConfirmations;
  activationConfirmations: ActivationConfirmationValues;
  errorCode?: string;
  reportFilename?: string;
};

type Action =
  | { type: "CHECK" }
  | { type: "CHECKED"; report: ActivationPreflightReport }
  | { type: "CONFIRM_PREPARE" }
  | { type: "SET_PREPARE_CONFIRMATION"; key: keyof ActivationPrepareConfirmations; value: boolean }
  | { type: "PREPARE" }
  | { type: "PREPARE_STAGE"; stage: ActivationPrepareStage }
  | { type: "PREPARED" }
  | { type: "CONFIRM_ACTIVATION" }
  | { type: "SET_ACTIVATION_CONFIRMATION"; key: keyof ActivationConfirmationValues; value: boolean }
  | { type: "ACTIVATION_STAGE"; stage: ActivationSwitchStage }
  | { type: "CANCEL" }
  | { type: "CANCELLED" }
  | { type: "ERROR"; code: string }
  | { type: "REPORT_DOWNLOADED"; filename: string };

const emptyPrepareConfirmations: ActivationPrepareConfirmations = {
  prepareOnly: false,
  freezeOtherPages: false,
  legacyRemainsActive: false,
  cancellationAvailable: false
};
const emptyActivationConfirmations: ActivationConfirmationValues = {
  indexedDbOnlyWrites: false,
  legacyRetainedReadOnly: false,
  noDirectMigrationRollback: false,
  recoveryOnBootFailure: false
};
const initialState: State = {
  status: "idle",
  prepareConfirmations: emptyPrepareConfirmations,
  activationConfirmations: emptyActivationConfirmations
};

export interface ActivationPreparePanelProps { onPreparedChange?: (prepared: boolean) => void; }

export function ActivationPreparePanel({ onPreparedChange }: ActivationPreparePanelProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<ActivationPrepareController | null>(null);
  const controller = controllerRef.current ?? (controllerRef.current = new ActivationPrepareController());
  const prepareComplete = Object.values(state.prepareConfirmations).every(Boolean);
  const activationComplete = Object.values(state.activationConfirmations).every(Boolean);
  const drifted = Boolean(state.report?.sourceDrift.drifted);
  const targetMismatch = Boolean(state.report?.issues.some((issue) =>
    issue.code === "ACTIVATION_TARGET_NOT_EQUIVALENT" || issue.code === "ACTIVATION_STORE_CHECKSUM_MISMATCH"));
  const safeCounts = useMemo(() => ({
    source: state.report?.sourceDrift.blocking ? "需要处理" : "一致",
    target: state.report?.equivalence.equivalent ? "完整一致" : "存在差异",
    backup: state.report?.backupStatus.verified ? "已验证" : "需要检查",
    migration: state.report?.migrationStatus.completed ? "已完成，尚未启用" : "未完成"
  }), [state.report]);

  async function checkConditions() {
    dispatch({ type: "CHECK" });
    try {
      const report = await controller.checkConditions();
      dispatch({ type: "CHECKED", report });
      if (report.multiTabStatus.markerState === "activation_prepared" && report.eligible) onPreparedChange?.(true);
    } catch (error) {
      dispatch({ type: "ERROR", code: safeErrorCode(error) });
    }
  }

  async function prepare() {
    dispatch({ type: "PREPARE" });
    try {
      await controller.prepare(state.prepareConfirmations, (stage) => dispatch({ type: "PREPARE_STAGE", stage }));
      dispatch({ type: "PREPARED" });
      onPreparedChange?.(true);
    } catch (error) {
      dispatch({ type: "ERROR", code: safeErrorCode(error) });
    }
  }

  async function activate() {
    try {
      await controller.activate(state.activationConfirmations, (stage) => dispatch({ type: "ACTIVATION_STAGE", stage }));
    } catch (error) {
      dispatch({ type: "ERROR", code: safeErrorCode(error) });
    }
  }

  async function cancelPrepare() {
    if (!state.report || !window.confirm("取消准备后会继续使用旧本地存储，新存储数据和备份都会保留。确定取消吗？")) return;
    dispatch({ type: "CANCEL" });
    try {
      await controller.cancelPrepare({
        activationId: state.report.activationCandidateId,
        migrationId: state.report.migrationId,
        userConfirmed: true
      }, (stage) => dispatch({ type: "PREPARE_STAGE", stage }));
      dispatch({ type: "CANCELLED" });
      onPreparedChange?.(false);
    } catch (error) {
      dispatch({ type: "ERROR", code: safeErrorCode(error) });
    }
  }

  function downloadReport() {
    if (!state.report) return;
    const prepared = controller.prepareSafeReportDownload(state.report);
    triggerPreparedBackupDownload(prepared);
    dispatch({ type: "REPORT_DOWNLOADED", filename: prepared.filename });
  }

  if (state.status === "idle") {
    return (
      <section className="migration-stage-card activation-panel" data-testid="activation-preflight-idle">
        <div className="activation-heading"><ShieldCheck aria-hidden="true" /><div><p className="migration-kicker">启用前检查</p><h2>新存储已写入，先确认能否安全启用</h2></div></div>
        <p>系统会重新核对当前收藏、原始备份、新存储和迁移记录。检查只读，不会切换数据源。</p>
        <div className="activation-current-source"><strong>当前数据源</strong><span>旧本地存储（localStorage）</span></div>
        <button className="primary-button" type="button" onClick={() => void checkConditions()}>检查启用条件</button>
      </section>
    );
  }

  if (isProgressState(state.status)) {
    return (
      <section className="migration-stage-card activation-panel" aria-live="polite" data-testid={`activation-${state.status}`}>
        <div className="activation-heading"><LoaderCircle className="activation-spinner" aria-hidden="true" /><div><p className="migration-kicker">数据源保护</p><h2>{progressLabel(state.status, state.stage)}</h2></div></div>
        <p>{state.status === "reloading" ? "启动标记已写入。页面将受控重新加载，并从 IndexedDB 完成启动验证。" : "普通写入保持冻结。只有全部复核通过后才会进入启动切换。"}</p>
      </section>
    );
  }

  if (state.status === "awaiting_activation_confirmation") {
    return (
      <section className="migration-stage-card activation-panel activation-panel--confirmation" data-testid="formal-activation-confirmation">
        <div className="activation-heading"><LockKeyhole aria-hidden="true" /><div><p className="migration-kicker">正式启用确认</p><h2>正式启用新存储？</h2></div></div>
        <p>启用后，新的收藏、备注、专辑、行动卡、计划和设置只会写入 IndexedDB。旧本地数据继续保留，但不再作为当前数据源。</p>
        <div className="activation-confirmations">
          {([
            ["indexedDbOnlyWrites", "我知道启用后，新修改只会写入 IndexedDB"],
            ["legacyRetainedReadOnly", "我知道旧 localStorage 会保留，但不再自动作为可写后备"],
            ["noDirectMigrationRollback", "我知道正式启用后，不能直接使用迁移前回滚"],
            ["recoveryOnBootFailure", "我知道启动失败时会进入恢复页面，而不是自动使用旧数据"]
          ] as const).map(([key, label]) => (
            <label key={key}><input type="checkbox" checked={state.activationConfirmations[key]} onChange={(event) => dispatch({ type: "SET_ACTIVATION_CONFIRMATION", key, value: event.target.checked })} /><span>{label}</span></label>
          ))}
        </div>
        <div className="migration-footer-actions">
          <button className="primary-button" type="button" disabled={!activationComplete} onClick={() => void activate()}>开始正式启用</button>
          <button className="migration-text-button" type="button" onClick={() => dispatch({ type: "PREPARED" })}>返回准备状态</button>
        </div>
      </section>
    );
  }

  if (state.status === "prepared") {
    return (
      <section className="migration-stage-card activation-panel activation-panel--success" data-testid="activation-prepared">
        <div className="activation-heading"><CheckCircle2 aria-hidden="true" /><div><p className="migration-kicker">准备完成</p><h2>已经准备好，但尚未切换</h2></div></div>
        <p>Bootstrap Marker 和 Activation Journal 已相互校验。当前权威数据源仍是 localStorage，普通写入保持冻结。</p>
        <dl className="activation-facts"><div><dt>当前数据源</dt><dd>localStorage</dd></div><div><dt>新存储</dt><dd>已准备，未启用</dd></div><div><dt>自动刷新</dt><dd>未执行</dd></div><div><dt>恢复能力</dt><dd>可取消准备</dd></div></dl>
        <div className="migration-footer-actions">
          <button className="primary-button" type="button" onClick={() => dispatch({ type: "CONFIRM_ACTIVATION" })}>正式启用新存储</button>
          <button className="secondary-button" type="button" onClick={() => void cancelPrepare()}><RotateCcw size={16} aria-hidden="true" />取消准备</button>
          {state.report && <button className="migration-text-button" type="button" onClick={downloadReport}><Download size={16} aria-hidden="true" />下载安全报告</button>}
        </div>
      </section>
    );
  }

  if (state.status === "confirming" && state.report) {
    return (
      <section className="migration-stage-card activation-panel" data-testid="activation-prepare-confirmation">
        <div className="activation-heading"><LockKeyhole aria-hidden="true" /><div><p className="migration-kicker">准备确认</p><h2>只准备启用，不正式切换</h2></div></div>
        <div className="activation-confirmations">
          {([
            ["prepareOnly", "我知道本次只记录准备状态，不会正式启用 IndexedDB"],
            ["freezeOtherPages", "我知道准备后其他页面的普通写入会被冻结"],
            ["legacyRemainsActive", "我知道当前正式数据源仍是 localStorage"],
            ["cancellationAvailable", "我知道可以先取消准备，再恢复或重新迁移"]
          ] as const).map(([key, label]) => (
            <label key={key}><input type="checkbox" checked={state.prepareConfirmations[key]} onChange={(event) => dispatch({ type: "SET_PREPARE_CONFIRMATION", key, value: event.target.checked })} /><span>{label}</span></label>
          ))}
        </div>
        <div className="migration-footer-actions"><button className="primary-button" type="button" disabled={!prepareComplete} onClick={() => void prepare()}>准备启用</button><button className="migration-text-button" type="button" onClick={() => dispatch({ type: "CHECKED", report: state.report! })}>返回检查结果</button></div>
      </section>
    );
  }

  if (state.status === "another_tab_active" || state.status === "error") {
    const anotherTab = state.status === "another_tab_active";
    return (
      <section className={`migration-stage-card activation-panel ${anotherTab ? "activation-panel--warning" : "activation-panel--danger"}`} role="alert" data-testid={anotherTab ? "activation-another-tab-active" : "activation-recovery-required"}>
        <div className="activation-heading"><AlertTriangle aria-hidden="true" /><div><p className="migration-kicker">写入保护</p><h2>{anotherTab ? "另一个页面正在处理存储切换" : "当前状态需要恢复检查"}</h2></div></div>
        <p>{anotherTab ? "当前页面没有取得唯一写入锁，请等待另一个页面完成。" : "系统没有清理任何收藏，也没有回退数据源。请保留现场并重新检查。"}</p>
        {state.errorCode && <details><summary>查看安全错误码</summary><code>{state.errorCode}</code></details>}
        <button className="secondary-button" type="button" onClick={() => void checkConditions()}>重新检查</button>
      </section>
    );
  }

  const blocked = state.status === "blocked";
  return (
    <section className={`migration-stage-card activation-panel ${blocked ? "activation-panel--warning" : "activation-panel--success"}`} data-testid={drifted ? "activation-source-drift" : targetMismatch ? "activation-target-mismatch" : blocked ? "activation-preflight-blocked" : "activation-preflight-passed"}>
      <div className="activation-heading">{blocked ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}<div><p className="migration-kicker">启用前检查结果</p><h2>{drifted ? "迁移后数据发生了变化" : targetMismatch ? "新存储与当前收藏不完全一致" : blocked ? "当前还不能安全准备启用" : "所有启用条件已经通过"}</h2></div></div>
      <p>{blocked ? "系统没有写入 Marker 或 Journal，当前收藏仍由旧本地存储管理。" : "当前收藏、原始备份、新存储和迁移记录已经完成完整核对。"}</p>
      <dl className="activation-facts"><div><dt>当前来源</dt><dd>{safeCounts.source}</dd></div><div><dt>新存储</dt><dd>{safeCounts.target}</dd></div><div><dt>原始备份</dt><dd>{safeCounts.backup}</dd></div><div><dt>迁移状态</dt><dd>{safeCounts.migration}</dd></div></dl>
      {state.report?.issues.length ? <details className="activation-issues"><summary>查看安全检查详情（{state.report.issues.length}）</summary><ul>{state.report.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><span>{issueLabel(issue.code)}</span><code>{issue.code}</code></li>)}</ul></details> : null}
      <div className="migration-footer-actions">{!blocked && <button className="primary-button" type="button" onClick={() => dispatch({ type: "CONFIRM_PREPARE" })}>确认准备启用</button>}<button className="migration-text-button" type="button" onClick={downloadReport}><Download size={16} aria-hidden="true" />下载安全报告</button><button className="migration-text-button" type="button" onClick={() => void checkConditions()}>重新检查</button></div>
      {state.reportFilename && <p className="migration-download-success" aria-live="polite">报告下载已触发：{state.reportFilename}</p>}
    </section>
  );
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CHECK": return { ...initialState, status: "checking" };
    case "CHECKED": return { ...state, status: action.report.multiTabStatus.markerState === "activation_prepared" && action.report.eligible ? "prepared" : action.report.eligible ? "eligible" : "blocked", report: action.report, errorCode: undefined };
    case "CONFIRM_PREPARE": return { ...state, status: "confirming" };
    case "SET_PREPARE_CONFIRMATION": return { ...state, prepareConfirmations: { ...state.prepareConfirmations, [action.key]: action.value } };
    case "PREPARE": return { ...state, status: "preparing", stage: "acquiring_activation_lock" };
    case "PREPARE_STAGE": return { ...state, stage: action.stage };
    case "PREPARED": return { ...state, status: "prepared", stage: "activation_prepared" };
    case "CONFIRM_ACTIVATION": return { ...state, status: "awaiting_activation_confirmation", activationConfirmations: emptyActivationConfirmations };
    case "SET_ACTIVATION_CONFIRMATION": return { ...state, activationConfirmations: { ...state.activationConfirmations, [action.key]: action.value } };
    case "ACTIVATION_STAGE": return { ...state, status: action.stage, stage: action.stage };
    case "CANCEL": return { ...state, status: "cancelling", stage: "cancelling_prepare" };
    case "CANCELLED": return { ...initialState, status: "idle" };
    case "ERROR": return { ...state, status: action.code === "MIGRATION_LOCK_UNAVAILABLE" ? "another_tab_active" : "error", errorCode: action.code };
    case "REPORT_DOWNLOADED": return { ...state, reportFilename: action.filename };
  }
}

function isProgressState(status: Status): boolean {
  return ["checking", "preparing", "cancelling", "acquiring_activation_lock", "final_rechecking", "writing_switch_journal", "writing_activating_marker", "reloading"].includes(status);
}
function progressLabel(status: Status, stage?: ActivationPrepareStage | ActivationSwitchStage): string {
  const labels: Record<string, string> = {
    checking: "正在核对当前来源和新存储",
    preparing: "正在记录准备状态",
    cancelling: "正在取消准备",
    acquiring_activation_lock: "正在获取唯一写入锁",
    final_rechecking: "正在执行正式启用前的最终检查",
    writing_switch_journal: "正在记录切换凭证",
    writing_activating_marker: "正在写入启动标记",
    reloading: "即将重新加载并验证 IndexedDB"
  };
  return labels[status] ?? labels[String(stage)] ?? "正在保护本地数据";
}
function safeErrorCode(error: unknown): string { return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "ACTIVATION_PREFLIGHT_FAILED"; }
function issueLabel(code: string): string { if (code.includes("SOURCE_DRIFT")) return "当前收藏发生变化"; if (code.includes("TARGET")) return "新存储检查未通过"; if (code.includes("BACKUP")) return "原始备份需要检查"; if (code.includes("CAPABILITY")) return "浏览器能力不足"; if (code.includes("JOURNAL") || code.includes("MARKER")) return "准备记录不一致"; return "迁移状态需要确认"; }