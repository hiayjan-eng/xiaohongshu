import { AlertTriangle, CheckCircle2, ChevronRight, Info, RefreshCw, RotateCcw } from "lucide-react";
import type { LegacySnapshotIssue, MigrationIssue, MigrationIssueCode } from "@revival/storage-service";
import { getIssuePresentation, getSafeIssueRecordLabel, STORAGE_ENTITY_LABELS } from "./migration-error-messages";
import type { MigrationInspectionResult, MigrationPreviewDataStateName } from "./migration-preview-types";

interface MigrationPreviewStepProps {
  status: MigrationPreviewDataStateName;
  data: MigrationInspectionResult;
  onOpenBackup: () => void;
  onReinspect: () => void;
  onReturnToImport: () => void;
}

interface DisplayIssueGroup {
  code: string;
  title: string;
  impact: string;
  recommendation: string;
  count: number;
  blocking: boolean;
  records: Array<{ label: string }>;
}

export function MigrationPreviewStep({
  status,
  data,
  onOpenBackup,
  onReinspect,
  onReturnToImport
}: MigrationPreviewStepProps) {
  if (data.disposition === "empty") {
    return (
      <section className="migration-stage-card migration-empty-state" data-testid="migration-empty-state">
        <span className="migration-stage-icon" aria-hidden="true"><Info size={22} /></span>
        <h2>当前没有找到可升级的收藏数据</h2>
        <p>这个浏览器里还没有收藏复活数据。你可以先扫描或导入收藏，再回来检查。</p>
        <button className="primary-button" type="button" onClick={onReturnToImport}>返回扫描与导入</button>
      </section>
    );
  }

  const headline = status === "preview_ready"
    ? "当前数据可以安全升级"
    : status === "review_required"
      ? "有部分数据需要先确认"
      : "当前数据还不能安全升级";
  const description = status === "preview_ready"
    ? `已检查 ${data.preview.stores.savedItems?.sourceCount ?? 0} 条收藏和相关记录。用户备注、手动标题、分类纠正、专辑状态、行动卡和计划都可以保留。`
    : status === "review_required"
      ? `其中 ${Math.max(data.preview.summary.totalManualReview, data.preview.summary.totalWarnings)} 条记录或提示需要处理，其余内容已经完成检查。当前不会修改任何数据。`
      : "备份或数据结构存在问题。当前收藏没有被修改，你仍然可以下载原始备份。";
  const issueGroups = buildIssueGroups(data.preview.issues, data.envelope.report.issues);
  const blocking = status === "blocked";

  return (
    <div className="migration-preview-stack" data-testid="migration-preview-step">
      <section className={`migration-conclusion migration-conclusion--${status}`} role={blocking ? "alert" : undefined}>
        <span aria-hidden="true">{blocking || status === "review_required" ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}</span>
        <div>
          <p className="migration-kicker">检查结论</p>
          <h2>{headline}</h2>
          <p>{description}</p>
        </div>
      </section>

      <section className="migration-stat-grid" aria-label="数据统计">
        <MigrationStat label="收藏" value={data.userSummary.counts.savedItems} unit="条" />
        <MigrationStat label="智能专辑" value={data.userSummary.counts.smartAlbums} unit="个" />
        <MigrationStat label="行动卡" value={data.userSummary.counts.actionCards} unit="张" />
        <MigrationStat label="计划卡" value={data.userSummary.counts.planCards} unit="张" />
      </section>

      <section className="migration-detail-grid">
        <DataGroupCard
          tone="preserve"
          title="将完整保留"
          summary="用户主动保存和调整的内容会逐项核对。"
          items={[
            `收藏和来源链接 · ${data.userSummary.counts.savedItems} 条`,
            "用户备注和用户手动标题",
            `手动分类与分类纠正 · ${data.userSummary.counts.corrections} 条`,
            `已确认和已归档专辑 · ${data.userSummary.counts.smartAlbums} 个`,
            `行动卡与计划卡 · ${data.userSummary.counts.actionCards + data.userSummary.counts.planCards} 份`,
            "主题和成就"
          ]}
        />
        <DataGroupCard
          tone="rebuild"
          title="升级后重新生成"
          summary="这些内容可由原收藏重新建立，不影响收藏本身。"
          items={["搜索索引", "临时推荐", "可重建的候选专辑", "页面缓存"]}
        />
        <DataGroupCard
          tone="exclude"
          title="默认不迁移"
          summary="这些内容不属于普通收藏资料。"
          items={["QA 测试数据", "真实试用测试记录", "developerMode", "浏览器扩展扫描断点", "API Key 和服务配置"]}
        />
        <section className="migration-data-group migration-data-group--review" data-testid="migration-review-groups">
          <div className="migration-data-group__heading">
            <div>
              <p className="migration-kicker">需要确认</p>
              <h3>{issueGroups.length > 0 ? `${issueGroups.length} 类问题或提示` : "当前没有待确认问题"}</h3>
            </div>
            <span>{blocking ? "阻止继续" : status === "review_required" ? "需要确认" : "已检查"}</span>
          </div>
          {issueGroups.length > 0 ? (
            <div className="migration-issue-list">
              {issueGroups.map((group) => (
                <details key={group.code} data-testid={`migration-issue-${group.code}`}>
                  <summary>
                    <span>
                      <strong>{group.title}</strong>
                      <small>{group.count} 项 · {group.blocking ? "会阻止后续升级" : "建议先确认"}</small>
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </summary>
                  <div className="migration-issue-body">
                    <p>{group.impact}</p>
                    <p><strong>建议：</strong>{group.recommendation}</p>
                    {group.records.length > 0 && (
                      <ul>
                        {group.records.slice(0, 5).map((record) => <li key={record.label}>{record.label}</li>)}
                      </ul>
                    )}
                    <details className="migration-technical-details">
                      <summary>技术详情</summary>
                      <code>错误代码：{group.code}</code>
                    </details>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="migration-group-empty"><CheckCircle2 size={17} aria-hidden="true" /> 没有发现需要人工处理的记录。</p>
          )}
        </section>
      </section>

      <section className="migration-preview-footer">
        <div>
          <strong>检查结果只保留在当前页面</strong>
          <span>刷新后需要重新检查；本轮不会启动迁移。</span>
        </div>
        <div className="migration-footer-actions">
          <button className="migration-text-button" type="button" onClick={onReinspect}><RefreshCw size={16} />重新检查</button>
          {data.rawBackupAvailable && (
            <button className="primary-button" type="button" onClick={onOpenBackup} data-testid="open-backup-step">
              {blocking ? "下载原始备份" : "下一步：保存原始备份"}
            </button>
          )}
        </div>
      </section>
      {blocking && !data.rawBackupAvailable && (
        <div className="migration-inline-error" role="alert">
          <RotateCcw size={18} aria-hidden="true" />
          <span>无法读取当前浏览器的本地数据。当前没有修改任何内容。</span>
        </div>
      )}
    </div>
  );
}

function MigrationStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="migration-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  );
}

function DataGroupCard({
  tone,
  title,
  summary,
  items
}: {
  tone: "preserve" | "rebuild" | "exclude";
  title: string;
  summary: string;
  items: string[];
}) {
  return (
    <section className={`migration-data-group migration-data-group--${tone}`}>
      <p className="migration-kicker">{title}</p>
      <h3>{summary}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}

function buildIssueGroups(migrationIssues: MigrationIssue[], legacyIssues: LegacySnapshotIssue[]): DisplayIssueGroup[] {
  const groups = new Map<string, DisplayIssueGroup>();
  const relevantMigrationIssues = migrationIssues.filter((issue) => issue.severity !== "info" || issue.requiresManualReview);
  for (const issue of relevantMigrationIssues) {
    const presentation = getIssuePresentation(issue.code);
    const existing = groups.get(issue.code) ?? {
      code: issue.code,
      ...presentation,
      count: 0,
      blocking: issue.severity === "blocking",
      records: []
    };
    existing.count += 1;
    existing.blocking ||= issue.severity === "blocking";
    const label = getSafeIssueRecordLabel(issue);
    if (label) existing.records.push({ label });
    groups.set(issue.code, existing);
  }

  for (const issue of legacyIssues.filter((entry) => entry.severity !== "info")) {
    const presentation = getIssuePresentation(issue.code);
    const existing = groups.get(issue.code) ?? {
      code: issue.code,
      ...presentation,
      count: 0,
      blocking: issue.severity === "error" || issue.code === "CHECKSUM_UNAVAILABLE",
      records: []
    };
    existing.count += 1;
    existing.blocking ||= issue.severity === "error" || issue.code === "CHECKSUM_UNAVAILABLE";
    const store = issue.store ? STORAGE_ENTITY_LABELS[issue.store] : "本地数据";
    const id = typeof issue.recordId === "string" || typeof issue.recordId === "number" ? String(issue.recordId).replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 72) : "";
    if (id) existing.records.push({ label: `${store} · ${id}` });
    groups.set(issue.code, existing);
  }

  return [...groups.values()].sort((left, right) => Number(right.blocking) - Number(left.blocking) || left.title.localeCompare(right.title, "zh-CN"));
}
