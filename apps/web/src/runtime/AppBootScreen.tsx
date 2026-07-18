import type { StorageRuntimeHealthIssue, StorageRuntimeWarning } from "@revival/storage-runtime";

type AppBootScreenProps = {
  mode: "loading" | "degraded" | "failed" | "activation_prepared" | "activation_switching" | "storage_recovery_required";
  issues?: Array<StorageRuntimeHealthIssue | StorageRuntimeWarning>;
  errorCode?: string;
  onRetry?: () => void;
  onOpenDataManagement?: () => void;
  onReload?: () => void;
};

export function AppBootScreen(props: AppBootScreenProps) {
  if (props.mode === "loading") {
    return (
      <main className="app-boot-screen" data-testid="app-boot-loading" aria-live="polite">
        <section className="app-boot-panel">
          <span className="app-boot-mark" aria-hidden="true">复</span>
          <p className="app-boot-kicker">收藏复活</p>
          <h1>正在打开收藏复活</h1>
          <p>正在读取这个浏览器里的收藏数据。</p>
          <div className="app-boot-progress" aria-hidden="true"><span /></div>
        </section>
      </main>
    );
  }

  if (props.mode === "activation_switching") {
    return (
      <main className="app-boot-screen" data-testid="app-write-gate-switching">
        <section className="app-boot-panel warning" role="alert">
          <p className="app-boot-kicker">本地数据保护</p>
          <h1>数据源正在切换</h1>
          <p>此页面已停止接收旧存储写入。请刷新页面，由启动检查从新存储重新打开，旧内存数据不会写入 IndexedDB。</p>
          <div className="app-boot-actions">
            <button type="button" className="primary-button" onClick={props.onReload}>刷新并重新打开</button>
          </div>
          <details className="app-boot-details"><summary>查看当前状态</summary><code>ACTIVATION_RELOAD_REQUIRED</code></details>
        </section>
      </main>
    );
  }

  if (props.mode === "activation_prepared" || props.mode === "storage_recovery_required") {
    const recovery = props.mode === "storage_recovery_required";
    return (
      <main className="app-boot-screen" data-testid={recovery ? "app-storage-recovery-required" : "app-activation-prepared"}>
        <section className={`app-boot-panel ${recovery ? "danger" : "warning"}`} role="alert">
          <p className="app-boot-kicker">本地数据保护</p>
          <h1>{recovery ? "存储准备记录需要检查" : "新存储已经准备，尚未切换"}</h1>
          <p>{recovery ? "启动标记无法安全确认，系统不会猜测数据源，也不会自动修复或清理。当前没有执行正式切换。" : "当前正式数据源仍是旧本地存储。普通编辑已冻结，请前往数据管理取消准备；正式启用属于下一阶段。"}</p>
          <div className="app-boot-actions">
            <button type="button" className="primary-button" onClick={props.onOpenDataManagement}>前往数据管理</button>
          </div>
          <details className="app-boot-details"><summary>查看当前状态</summary><code>{recovery ? "ACTIVATION_MARKER_INVALID" : "ACTIVATION_PREPARED"}</code></details>
        </section>
      </main>
    );
  }
  const degraded = props.mode === "degraded";
  const code = props.errorCode ?? props.issues?.find((issue) => issue.blocking)?.code;
  return (
    <main className="app-boot-screen" data-testid={degraded ? "app-boot-degraded" : "app-boot-failed"}>
      <section className={`app-boot-panel ${degraded ? "warning" : "danger"}`} role="alert">
        <span className="app-boot-mark" aria-hidden="true">复</span>
        <p className="app-boot-kicker">本地数据保护</p>
        <h1>{degraded ? "本地数据需要检查" : "暂时无法打开本地收藏"}</h1>
        <p>
          {degraded
            ? "当前数据没有被自动覆盖。部分内容无法完整读取，请先保留浏览器数据并查看问题。"
            : "当前没有修改任何数据。请不要清理浏览器数据。"}
        </p>
        <div className="app-boot-actions">
          <button type="button" className="primary-button" onClick={props.onRetry}>重试读取</button>
          <button type="button" className="secondary-button" onClick={props.onOpenDataManagement}>前往数据管理</button>
        </div>
        {code && (
          <details className="app-boot-details">
            <summary>查看安全错误码</summary>
            <code>{code}</code>
          </details>
        )}
      </section>
    </main>
  );
}
