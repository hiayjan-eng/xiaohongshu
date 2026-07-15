import { ArrowRight, Database } from "lucide-react";

interface MigrationDataUpgradeEntryProps {
  onOpen: () => void;
}

export function MigrationDataUpgradeEntry({ onOpen }: MigrationDataUpgradeEntryProps) {
  return (
    <section className="tool-panel single settings-list migration-settings-entry" data-testid="migration-settings-entry">
      <div className="migration-settings-entry__heading">
        <span className="migration-icon" aria-hidden="true"><Database size={20} /></span>
        <div>
          <p className="eyebrow">数据管理</p>
          <h2>升级本地数据存储</h2>
        </div>
        <span className="migration-status-pill">尚未检查当前数据</span>
      </div>
      <p>
        为了支持几千条收藏和更稳定的搜索，可以把当前浏览器中的收藏升级到新的本地存储方式。升级前会生成完整备份，不会删除现有收藏。
      </p>
      <div className="migration-settings-entry__actions">
        <button className="primary-button" type="button" onClick={onOpen} data-testid="open-data-migration">
          检查当前数据 <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button className="migration-text-button" type="button" onClick={onOpen}>了解升级内容</button>
      </div>
      <small>当前步骤只会读取和检查数据，不会修改收藏，也不会开始升级。</small>
    </section>
  );
}
