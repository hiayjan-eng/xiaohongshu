import { ArrowRight, CheckCircle2, Database } from "lucide-react";

interface MigrationDataUpgradeEntryProps {
  onOpen: () => void;
  runtimeKind: "localStorage" | "indexedDB";
  activatedAt?: string;
}

export function MigrationDataUpgradeEntry({ onOpen, runtimeKind, activatedAt }: MigrationDataUpgradeEntryProps) {
  const indexedDbActive = runtimeKind === "indexedDB";
  return (
    <section className="tool-panel single settings-list migration-settings-entry" data-testid="migration-settings-entry">
      <div className="migration-settings-entry__heading">
        <span className="migration-icon" aria-hidden="true"><Database size={20} /></span>
        <div>
          <p className="eyebrow">数据管理</p>
          <h2>{indexedDbActive ? "本地数据存储状态" : "升级本地数据存储"}</h2>
        </div>
        <span className={`migration-status-pill${indexedDbActive ? " migration-status-pill--active" : ""}`} data-testid="storage-runtime-status">
          {indexedDbActive ? <><CheckCircle2 size={15} aria-hidden="true" /> IndexedDB 已启用</> : "尚未检查当前数据"}
        </span>
      </div>

      {indexedDbActive ? (
        <>
          <dl className="migration-storage-status" data-testid="indexeddb-storage-status">
            <div><dt>当前数据源</dt><dd>IndexedDB</dd></div>
            <div><dt>旧本地数据</dt><dd>保留，只读历史快照</dd></div>
            <div><dt>健康状态</dt><dd>正常</dd></div>
            <div><dt>启用时间</dt><dd>{formatActivationTime(activatedAt)}</dd></div>
          </dl>
          <p>新的收藏、备注、专辑、行动卡、计划和设置只写入 IndexedDB。旧 localStorage 数据仍保留，不会双写，也不会在启动失败时静默回退。</p>
        </>
      ) : (
        <p>为了支持几千条收藏和更稳定的搜索，可以把当前浏览器中的收藏升级到新的本地存储方式。升级前会生成完整备份，不会删除现有收藏。</p>
      )}

      <div className="migration-settings-entry__actions">
        <button className="primary-button" type="button" onClick={onOpen} data-testid="open-data-migration">
          {indexedDbActive ? "查看存储状态" : "检查当前数据"} <ArrowRight size={16} aria-hidden="true" />
        </button>
        {!indexedDbActive && <button className="migration-text-button" type="button" onClick={onOpen}>了解升级内容</button>}
      </div>
      <small>{indexedDbActive ? "正式启用后不提供一键切回或清空新存储。恢复操作会先验证现有证据。" : "当前步骤只会读取和检查数据，不会修改收藏，也不会开始升级。"}</small>
    </section>
  );
}

function formatActivationTime(value?: string): string {
  if (!value) return "已启用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "已启用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}