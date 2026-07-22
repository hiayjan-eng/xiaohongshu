import { useCallback, useState } from "react";
import { Archive, Import, LayoutDashboard, LayoutGrid, Search, Settings, Sparkles } from "lucide-react";
import { MIGRATION_LEAVE_WARNING, MigrationDataUpgradePage } from "../features/storage-migration";

const migrationRouteNavigation = [
  { label: "今日复活", path: "/dashboard", icon: LayoutDashboard },
  { label: "导入中心", path: "/import", icon: Import },
  { label: "智能专辑", path: "/albums", icon: LayoutGrid },
  { label: "搜索找回", path: "/search", icon: Search },
  { label: "收藏池", path: "/pool", icon: Archive },
  { label: "旧收藏 Beta", path: "/old-import", icon: Sparkles },
  { label: "设置", path: "/settings", icon: Settings }
] as const;

export function MigrationRouteShell() {
  const [executionActive, setExecutionActive] = useState(false);
  const navigate = useCallback((path: string) => {
    if (executionActive && !window.confirm(MIGRATION_LEAVE_WARNING)) return;
    window.location.assign(path);
  }, [executionActive]);

  return (
    <div className="app-shell migration-route-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("/")}>
          <span className="brand-mark">复</span>
          <span>
            <strong>收藏复活</strong>
            <small>从心动到行动</small>
          </span>
        </button>
        <nav className="nav-list" aria-label="主导航">
          {migrationRouteNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                className={item.path === "/settings" ? "nav-item active" : "nav-item"}
                onClick={() => navigate(item.path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <Sparkles size={18} />
          <span>不是收藏更多，是复活一条。</span>
        </div>
      </aside>
      <main className="main migration-route-main">
        <MigrationDataUpgradePage
          onBackToSettings={() => navigate("/settings")}
          onReturnToImport={() => navigate("/import")}
          onExecutionActiveChange={setExecutionActive}
        />
      </main>
    </div>
  );
}
