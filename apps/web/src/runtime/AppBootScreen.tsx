import type { StorageRuntimeHealthIssue, StorageRuntimeWarning } from "@revival/storage-runtime";

type AppBootScreenProps = {
  mode: "loading" | "degraded" | "failed";
  issues?: Array<StorageRuntimeHealthIssue | StorageRuntimeWarning>;
  errorCode?: string;
  onRetry?: () => void;
  onOpenDataManagement?: () => void;
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
