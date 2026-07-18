import { AlertTriangle, CheckCircle2, Download, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo, useReducer, useRef } from "react";
import type { ActivationPreflightReport, ActivationPrepareConfirmations, ActivationPrepareStage } from "@revival/storage-runtime";
import { ActivationPrepareController } from "./activation-prepare-controller";
import { triggerPreparedBackupDownload } from "./MigrationBackupStep";

type Status = "idle" | "checking" | "eligible" | "blocked" | "confirming" | "preparing" | "prepared" | "cancelling" | "another_tab_active" | "error";
type State = { status: Status; report?: ActivationPreflightReport; stage?: ActivationPrepareStage; confirmations: ActivationPrepareConfirmations; errorCode?: string; reportFilename?: string };
type Action =
  | { type: "CHECK" }
  | { type: "CHECKED"; report: ActivationPreflightReport }
  | { type: "CONFIRM" }
  | { type: "SET_CONFIRMATION"; key: keyof ActivationPrepareConfirmations; value: boolean }
  | { type: "PREPARE" }
  | { type: "STAGE"; stage: ActivationPrepareStage }
  | { type: "PREPARED" }
  | { type: "CANCEL" }
  | { type: "CANCELLED" }
  | { type: "ERROR"; code: string }
  | { type: "REPORT_DOWNLOADED"; filename: string };

const initialState: State = {
  status: "idle",
  confirmations: { prepareOnly: false, freezeOtherPages: false, legacyRemainsActive: false, cancellationAvailable: false }
};

export interface ActivationPreparePanelProps {
  onPreparedChange?: (prepared: boolean) => void;
}

export function ActivationPreparePanel({ onPreparedChange }: ActivationPreparePanelProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<ActivationPrepareController | null>(null);
  const controller = controllerRef.current ?? (controllerRef.current = new ActivationPrepareController());
  const confirmationsComplete = Object.values(state.confirmations).every(Boolean);
  const drifted = Boolean(state.report?.sourceDrift.drifted);
  const targetMismatch = Boolean(state.report?.issues.some((issue) => issue.code === "ACTIVATION_TARGET_NOT_EQUIVALENT" || issue.code === "ACTIVATION_STORE_CHECKSUM_MISMATCH"));
  const safeCounts = useMemo(() => ({
    source: state.report?.sourceDrift.blocking ? "旧本地存储 · 需要处理" : "旧本地存储 · 一致",
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
      await controller.prepare(state.confirmations, (stage) => dispatch({ type: "STAGE", stage }));
      dispatch({ type: "PREPARED" });
      onPreparedChange?.(true);
    } catch (error) {
      dispatch({ type: "ERROR", code: safeErrorCode(error) });
    }
  }

  async function cancelPrepare() {
    if (!state.report || !window.confirm("取消准备后，当前产品会继续使用旧本地存储。新存储数据和备份都会保留。确定取消吗？")) return;
    dispatch({ type: "CANCEL" });
    try {
      await controller.cancelPrepare({
        activationId: state.report.activationCandidateId,
        migrationId: state.report.migrationId,
        userConfirmed: true
      }, (stage) => dispatch({ type: "STAGE", stage }));
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
        <div className="activation-heading"><ShieldCheck aria-hidden="true" /><div><p className="migration-kicker">启用前检查</p><h2>新存储已写入，先确认是否仍可安全启用</h2></div></div>
        <p>系统会重新核对当前收藏、原始备份、新存储和迁移记录。检查只读，不会切换数据源。</p>
        <div className="activation-current-source"><strong>当前数据源</strong><span>旧本地存储（localStorage）</span></div>
        <button className="primary-button" type="button" onClick={() => void checkConditions()}>检查启用条件</button>
      </section>
    );
  }

  if (state.status === "checking" || state.status === "preparing" || state.status === "cancelling") {
    const preparing = state.status === "preparing";
    return (
      <section className="migration-stage-card activation-panel" aria-live="polite" data-testid={`activation-${state.status}`}>
        <div className="activation-heading"><LoaderCircle className="activation-spinner" aria-hidden="true" /><div><p className="migration-kicker">{preparing ? "正在准备" : state.status === "cancelling" ? "正在取消准备" : "正在检查"}</p><h2>{stageLabel(state.stage, state.status)}</h2></div></div>
        <p>当前正式数据源仍是旧本地存储。请保留这个页面，系统不会自动刷新或切换。</p>
      </section>
    );
  }

  if (state.status === "prepared") {
    return (
      <section className="migration-stage-card activation-panel activation-panel--success" data-testid="activation-prepared">
        <div className="activation-heading"><CheckCircle2 aria-hidden="true" /><div><p className="migration-kicker">准备完成</p><h2>已经准备好，但尚未切换</h2></div></div>
        <p>Bootstrap Marker 和 Activation Journal 已相互校验。普通写入已冻结，下一阶段才会执行受控切换。</p>
        <dl className="activation-facts"><div><dt>当前数据源</dt><dd>localStorage</dd></div><div><dt>新存储</dt><dd>已准备，未启用</dd></div><div><dt>自动刷新</dt><dd>未执行</dd></div><div><dt>恢复能力</dt><dd>可取消准备</dd></div></dl>
        <div className="migration-footer-actions"><button className="secondary-button" type="button" onClick={() => void cancelPrepare()}><RotateCcw size={16} aria-hidden="true" />取消准备</button>{state.report && <button className="migration-text-button" type="button" onClick={downloadReport}><Download size={16} aria-hidden="true" />下载安全报告</button>}</div>
      </section>
    );
  }

  if (state.status === "another_tab_active") {
    return (
      <section className="migration-stage-card activation-panel activation-panel--warning" role="status" data-testid="activation-another-tab-active">
        <div className="activation-heading"><LockKeyhole aria-hidden="true" /><div><p className="migration-kicker">写入保护已生效</p><h2>另一个页面正在处理启用准备</h2></div></div>
        <p>当前页面没有取得唯一写入锁，因此没有写入 Marker 或 Journal。请等待另一个页面完成后重新检查。</p>
        <button className="secondary-button" type="button" onClick={() => void checkConditions()}>重新检查</button>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="migration-stage-card activation-panel activation-panel--danger" role="alert" data-testid="activation-recovery-required">
        <div className="activation-heading"><AlertTriangle aria-hidden="true" /><div><p className="migration-kicker">需要人工确认</p><h2>当前状态不能继续准备</h2></div></div>
        <p>系统没有切换数据源，也没有清理任何收藏。请保留浏览器数据并返回数据管理重新检查。</p>
        <details><summary>查看安全错误码</summary><code>{state.errorCode}</code></details>
        <button className="secondary-button" type="button" onClick={() => void checkConditions()}>重新检查</button>
      </section>
    );
  }

  if (state.status === "confirming" && state.report) {
    return (
      <section className="migration-stage-card activation-panel" data-testid="activation-prepare-confirmation">
        <div className="activation-heading"><LockKeyhole aria-hidden="true" /><div><p className="migration-kicker">最后确认</p><h2>只准备启用，不正式切换</h2></div></div>
        <div className="activation-confirmations">
          {([
            ["prepareOnly", "我知道本次只记录准备状态，不会正式启用 IndexedDB"],
            ["freezeOtherPages", "我知道准备后其他页面的普通写入会被冻结"],
            ["legacyRemainsActive", "我知道当前正式数据源仍是 localStorage"],
            ["cancellationAvailable", "我知道可以先取消准备，再恢复或重新迁移"]
          ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={state.confirmations[key]} onChange={(event) => dispatch({ type: "SET_CONFIRMATION", key, value: event.target.checked })} /><span>{label}</span></label>)}
        </div>
        <div className="migration-footer-actions"><button className="primary-button" type="button" disabled={!confirmationsComplete} onClick={() => void prepare()}>准备启用</button><button className="migration-text-button" type="button" onClick={() => dispatch({ type: "CHECKED", report: state.report! })}>返回检查结果</button></div>
      </section>
    );
  }

  const blocked = state.status === "blocked";
  return (
    <section className={`migration-stage-card activation-panel ${blocked ? "activation-panel--warning" : "activation-panel--success"}`} data-testid={drifted ? "activation-source-drift" : targetMismatch ? "activation-target-mismatch" : blocked ? "activation-preflight-blocked" : "activation-preflight-passed"}>
      <div className="activation-heading">{blocked ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}<div><p className="migration-kicker">启用前检查结果</p><h2>{drifted ? "当前收藏在迁移后发生了变化" : targetMismatch ? "新存储与当前收藏不完全一致" : blocked ? "当前还不能安全准备启用" : "所有启用条件已经通过"}</h2></div></div>
      <p>{drifted ? "迁移完成后，当前收藏、主题或成就又发生了变化。为了避免遗漏最新内容，不能直接启用新存储。" : blocked ? "系统没有写入 Marker 或 Journal，当前收藏仍由旧本地存储管理。" : "当前收藏、原始备份、新存储和迁移记录已经完成完整核对。"}</p>
      <dl className="activation-facts"><div><dt>当前来源</dt><dd>{safeCounts.source}</dd></div><div><dt>新存储</dt><dd>{safeCounts.target}</dd></div><div><dt>原始备份</dt><dd>{safeCounts.backup}</dd></div><div><dt>迁移状态</dt><dd>{safeCounts.migration}</dd></div></dl>
      {drifted && <ul className="activation-drift-list">{(["app_state", "theme", "achievements"] as const).map((domain) => <li key={domain}><span>{domainLabel(domain)}</span><strong>{state.report?.sourceDrift.changedDomains.includes(domain) ? "已变化" : "未变化"}</strong></li>)}</ul>}
      {state.report?.issues.length ? <details className="activation-issues"><summary>查看安全检查详情（{state.report.issues.length}）</summary><ul>{state.report.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><span>{issueLabel(issue.code)}</span><code>{issue.code}</code></li>)}</ul></details> : null}
      <div className="migration-footer-actions">{!blocked && <button className="primary-button" type="button" onClick={() => dispatch({ type: "CONFIRM" })}>确认准备启用</button>}<button className="migration-text-button" type="button" onClick={downloadReport}><Download size={16} aria-hidden="true" />下载安全报告</button><button className="migration-text-button" type="button" onClick={() => void checkConditions()}>重新检查</button></div>
      {state.reportFilename && <p className="migration-download-success" aria-live="polite">报告下载已触发：{state.reportFilename}</p>}
    </section>
  );
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CHECK": return { ...initialState, status: "checking" };
    case "CHECKED": return { ...state, status: action.report.multiTabStatus.markerState === "activation_prepared" && action.report.eligible ? "prepared" : action.report.eligible ? "eligible" : "blocked", report: action.report, errorCode: undefined };
    case "CONFIRM": return { ...state, status: "confirming" };
    case "SET_CONFIRMATION": return { ...state, confirmations: { ...state.confirmations, [action.key]: action.value } };
    case "PREPARE": return { ...state, status: "preparing", stage: "acquiring_activation_lock" };
    case "STAGE": return { ...state, stage: action.stage };
    case "PREPARED": return { ...state, status: "prepared", stage: "activation_prepared" };
    case "CANCEL": return { ...state, status: "cancelling", stage: "cancelling_prepare" };
    case "CANCELLED": return { ...initialState, status: "idle" };
    case "ERROR": return { ...state, status: action.code === "MIGRATION_LOCK_UNAVAILABLE" ? "another_tab_active" : "error", errorCode: action.code };
    case "REPORT_DOWNLOADED": return { ...state, reportFilename: action.filename };
  }
}

function stageLabel(stage: ActivationPrepareStage | undefined, status: Status): string {
  if (status === "checking") return "正在核对当前来源和新存储";
  if (status === "cancelling") return "正在恢复旧本地存储写入";
  const labels: Partial<Record<ActivationPrepareStage, string>> = { acquiring_activation_lock: "正在获取唯一写入锁", freezing_writes: "正在保存并冻结普通写入", refreshing_source: "正在重新读取当前收藏", checking_source_drift: "正在检查迁移后的变化", checking_target: "正在检查新存储", checking_equivalence: "正在核对完整等价", creating_activation_journal: "正在记录准备凭证", writing_bootstrap_marker: "正在写入启动标记", finalizing_prepare: "正在完成交叉校验" };
  return labels[stage ?? "acquiring_activation_lock"] ?? "正在准备启用";
}

function safeErrorCode(error: unknown): string { return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : "ACTIVATION_PREFLIGHT_FAILED"; }
function domainLabel(domain: "app_state" | "theme" | "achievements"): string { return domain === "app_state" ? "主收藏数据" : domain === "theme" ? "主题" : "成就"; }
function issueLabel(code: string): string { if (code.includes("SOURCE_DRIFT")) return "当前收藏发生变化"; if (code.includes("TARGET")) return "新存储检查未通过"; if (code.includes("BACKUP")) return "原始备份需要检查"; if (code.includes("CAPABILITY")) return "浏览器能力不足"; if (code.includes("JOURNAL") || code.includes("MARKER")) return "准备记录不一致"; return "迁移状态需要确认"; }