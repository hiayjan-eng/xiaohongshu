import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clipboard, Download, ExternalLink, FileJson, FileText, Play, Search, Trash2 } from "lucide-react";
import { createImportedRecords } from "@revival/database";
import { searchSavedItems } from "@revival/search-service";
import type {
  ActionCard,
  ActionCardRating,
  AiClassificationResult,
  ClassificationRating,
  NextStepRating,
  RealUserTestRecord,
  RewardRating,
  SavedItem,
  ShareInput,
  TodayWillingness
} from "@revival/shared-types";

export const REAL_TEST_STORAGE_KEY = "collection-revival-real-user-tests:v1";

const emptyInput: ShareInput = {
  sourceUrl: "",
  title: "",
  rawShareText: "",
  userNote: ""
};

const classificationOptions: Array<{ value: ClassificationRating; label: string }> = [
  { value: "accurate", label: "准确" },
  { value: "acceptable", label: "勉强" },
  { value: "wrong", label: "不准确" }
];

const actionCardOptions: Array<{ value: ActionCardRating; label: string }> = [
  { value: "useful", label: "有用" },
  { value: "average", label: "一般" },
  { value: "useless", label: "没用" }
];

const nextStepOptions: Array<{ value: NextStepRating; label: string }> = [
  { value: "clear", label: "是" },
  { value: "unclear", label: "不太明确" },
  { value: "no", label: "否" }
];

const willingnessOptions: Array<{ value: TodayWillingness; label: string }> = [
  { value: "willing", label: "愿意" },
  { value: "later", label: "以后再说" },
  { value: "unwilling", label: "不愿意" }
];

const rewardOptions: Array<{ value: RewardRating; label: string }> = [
  { value: "satisfying", label: "有爽感" },
  { value: "average", label: "一般" },
  { value: "none", label: "没感觉" }
];

const classificationLabels: Record<ClassificationRating, string> = {
  accurate: "准确",
  acceptable: "勉强",
  wrong: "不准确"
};

const actionCardLabels: Record<ActionCardRating, string> = {
  useful: "有用",
  average: "一般",
  useless: "没用"
};

const willingnessLabels: Record<TodayWillingness, string> = {
  willing: "愿意",
  later: "以后再说",
  unwilling: "不愿意"
};

type RealTestViewProps = {
  userId: string;
  savedItems: SavedItem[];
  actionCards: ActionCard[];
  onCreateRecords: (savedItem: SavedItem, actionCard: ActionCard) => void;
  classifyShareInput: (input: ShareInput) => Promise<AiClassificationResult>;
  openSource: (item: SavedItem) => void;
  viewActionCard: (itemId: string) => void;
  setToast: (message: string) => void;
};

export function RealTestView(props: RealTestViewProps) {
  const [records, setRecords] = useState<RealUserTestRecord[]>(() => loadRealTestRecords());
  const [input, setInput] = useState<ShareInput>(emptyInput);
  const [currentRecordId, setCurrentRecordId] = useState<string | undefined>(records[0]?.id);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    persistRealTestRecords(records);
  }, [records]);

  const currentRecord = useMemo(
    () => records.find((record) => record.id === currentRecordId) ?? records[0],
    [currentRecordId, records]
  );

  const currentItem = useMemo(
    () => (currentRecord ? props.savedItems.find((item) => item.id === currentRecord.savedItemId) : undefined),
    [currentRecord, props.savedItems]
  );

  const currentCard = useMemo(
    () => (currentRecord ? props.actionCards.find((card) => card.savedItemId === currentRecord.savedItemId) : undefined),
    [currentRecord, props.actionCards]
  );

  const stats = useMemo(() => buildRealTestStats(records), [records]);

  function updateInput(field: keyof ShareInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  function handleGenerate(event: FormEvent) {
    event.preventDefault();
    const cleanInput = normalizeInput(input);
    if (!cleanInput.sourceUrl && !cleanInput.title && !cleanInput.rawShareText) {
      props.setToast("至少填一个链接、标题或分享文案");
      return;
    }

    setIsGenerating(true);
    window.setTimeout(() => {
      void props.classifyShareInput(cleanInput)
        .then((aiResult) => {
          const { savedItem, actionCard } = createImportedRecords(props.userId, cleanInput, aiResult);
          const now = new Date().toISOString();
          const record: RealUserTestRecord = {
            id: `real_test_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
            savedItemId: savedItem.id,
            sourceUrl: savedItem.sourceUrl,
            title: savedItem.title,
            rawShareText: savedItem.rawShareText,
            userNote: savedItem.userNote,
            category: savedItem.category,
            subCategory: savedItem.subCategory,
            summary: savedItem.summary,
            keywords: savedItem.keywords,
            entities: savedItem.entities,
            nextAction: actionCard.nextAction,
            createdAt: now,
            updatedAt: now
          };

          props.onCreateRecords(savedItem, actionCard);
          setRecords((current) => [record, ...current]);
          setCurrentRecordId(record.id);
          setInput(emptyInput);
          props.setToast("已生成一条真实试用记录");
        })
        .catch((error) => {
          props.setToast(error instanceof Error ? error.message : "生成试用记录失败");
        })
        .finally(() => setIsGenerating(false));
    }, 360);
  }

  function patchRecord(recordId: string, patch: Partial<RealUserTestRecord>) {
    const updatedAt = new Date().toISOString();
    setRecords((current) => current.map((record) => (record.id === recordId ? { ...record, ...patch, updatedAt } : record)));
  }

  function patchCurrent(patch: Partial<RealUserTestRecord>) {
    if (!currentRecord) return;
    patchRecord(currentRecord.id, patch);
  }

  function testSearch() {
    if (!currentRecord) return;
    const query = currentRecord.searchQuery?.trim();
    if (!query) {
      props.setToast("先填一个你会用来搜索它的词");
      return;
    }

    const results = searchSavedItems(query, props.savedItems, props.actionCards);
    const matched = results.find((result) => result.item.id === currentRecord.savedItemId);
    patchCurrent({
      searchFound: Boolean(matched),
      searchMatchReason: matched?.matchReasons.join("，") ?? "这次没有命中当前试用内容"
    });
    props.setToast(matched ? "搜索能找回这条收藏" : "这次没找到，记录下来后面优化");
  }

  function saveCurrent() {
    if (!currentRecord) return;
    patchCurrent({});
    props.setToast("已保存这条试用记录");
  }

  function deleteRecord(recordId: string) {
    setRecords((current) => current.filter((record) => record.id !== recordId));
    if (currentRecordId === recordId) {
      const nextRecord = records.find((record) => record.id !== recordId);
      setCurrentRecordId(nextRecord?.id);
    }
    props.setToast("已删除这条试用记录");
  }

  function exportMarkdown() {
    downloadText("collection-revival-real-test.md", buildMarkdownExport(records, stats), "text/markdown;charset=utf-8");
    props.setToast("Markdown 试用报告已导出");
  }

  function exportJson() {
    downloadText("collection-revival-real-test.json", JSON.stringify({ stats, records }, null, 2), "application/json;charset=utf-8");
    props.setToast("JSON 试用数据已导出");
  }

  function copySummary() {
    const text = buildCopySummary(records, stats);
    void navigator.clipboard?.writeText(text);
    props.setToast("试用总结已复制");
  }

  const fallbackItem = currentRecord ? recordToSavedItem(currentRecord, props.userId) : undefined;
  const visibleItem = currentItem ?? fallbackItem;
  const visibleCard = currentCard;

  return (
    <div className="real-test-page">
      <div className="page-title-row real-test-hero">
        <div>
          <p className="eyebrow">真实试用模式</p>
          <h1>真实试用模式</h1>
        </div>
        <p className="page-lead">用 20 条你真的想收藏的小红书内容，测试这个产品到底有没有用。</p>
      </div>

      <section className="tool-panel friend-test-entry" data-testid="friend-test-entry">
        <div>
          <span className="friend-test-kicker">朋友测试入口</span>
          <strong>建议朋友用 3-5 条真实收藏跑一轮</strong>
          <p>每条只需要导入、看行动卡、测一个搜索词、点选评价，最后复制试用总结发回来。数据只保存在朋友自己的浏览器里，请不要输入隐私信息。</p>
        </div>
        <div className="friend-test-steps">
          <span>1 导入收藏</span>
          <span>2 看行动卡</span>
          <span>3 看智能专辑</span>
          <span>4 搜索找回</span>
          <span>5 复制反馈</span>
        </div>
      </section>

      <section className="real-test-stats" aria-label="试用进度">
        <RealTestStat label="已测试" value={`${records.length} / 20`} testId="real-test-stat-tested" />
        <RealTestStat label="分类准确率" value={formatPercent(stats.classificationAccuracy)} testId="real-test-stat-classification" />
        <RealTestStat label="行动卡有用率" value={formatPercent(stats.actionCardUsefulRate)} testId="real-test-stat-action" />
        <RealTestStat label="下一步明确率" value={formatPercent(stats.nextStepClearRate)} testId="real-test-stat-next-step" />
        <RealTestStat label="搜索找回率" value={formatPercent(stats.searchRecallRate)} testId="real-test-stat-search" />
        <RealTestStat label="今日行动意愿" value={formatPercent(stats.todayWillingRate)} testId="real-test-stat-today" />
        <RealTestStat label="完成反馈满意度" value={formatPercent(stats.rewardSatisfactionRate)} testId="real-test-stat-reward" />
      </section>

      <div className="real-test-layout">
        <section className="tool-panel real-test-panel">
          <PanelTitle index="1" title="导入一条真实收藏" />
          <form className="real-test-import" onSubmit={handleGenerate}>
            <label>
              <span>原帖链接 sourceUrl</span>
              <input data-testid="real-test-source-url" value={input.sourceUrl} onChange={(event) => updateInput("sourceUrl", event.target.value)} placeholder="粘贴小红书分享链接" />
            </label>
            <label>
              <span>标题 title</span>
              <input data-testid="real-test-title" value={input.title} onChange={(event) => updateInput("title", event.target.value)} placeholder="例如：小红书封面设计技巧" />
            </label>
            <label>
              <span>分享文案 rawShareText，可选</span>
              <textarea data-testid="real-test-raw-share-text" value={input.rawShareText} onChange={(event) => updateInput("rawShareText", event.target.value)} placeholder="系统分享面板带过来的可用文本" />
            </label>
            <label>
              <span>我为什么想收藏它 userNote，可选</span>
              <textarea data-testid="real-test-user-note" value={input.userNote} onChange={(event) => updateInput("userNote", event.target.value)} placeholder="比如：之后做图文时可以参考" />
            </label>
            <button className="primary-button" type="submit" disabled={isGenerating} data-testid="real-test-generate">
              {isGenerating ? "正在生成行动卡..." : "生成行动卡并开始测试"}
            </button>
            <p className="quiet-copy">第一版仍然不读取小红书收藏夹，不抓原帖内容，只处理你手动粘贴的链接和可用文本。</p>
          </form>
        </section>

        <section className="tool-panel real-test-panel" data-testid="real-test-generated-result">
          <PanelTitle index="2" title="系统生成结果" />
          {currentRecord && visibleItem ? (
            <div className="real-test-result-card">
              <div className="row-meta">
                <span>{currentRecord.category}</span>
                <span>{currentRecord.keywords.slice(0, 3).join(" / ") || "待提取关键词"}</span>
              </div>
              <h2>{currentRecord.title}</h2>
              <p>{currentRecord.summary}</p>
              <div className="tag-list">
                {currentRecord.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
              </div>
              <div className="entity-list">
                {currentRecord.entities.map((entity) => <span key={`${entity.type}-${entity.value}`}>{entity.value}</span>)}
              </div>
              <div className="next-action-box">
                <small>下一步行动</small>
                <strong>{currentRecord.nextAction}</strong>
              </div>
              {visibleCard && (
                <div className="real-test-card-fields">
                  {Object.entries(visibleCard.fields).slice(0, 6).map(([key, value]) => (
                    <span key={key}><strong>{key}</strong>{Array.isArray(value) ? value.join(" / ") : value}</span>
                  ))}
                </div>
              )}
              <div className="real-test-actions">
                <button className="secondary-action" onClick={() => props.openSource(visibleItem)}>
                  <ExternalLink size={16} /> 打开原帖
                </button>
                <button className="primary-button" onClick={() => props.viewActionCard(currentRecord.savedItemId)}>
                  <Play size={16} /> 查看行动卡
                </button>
              </div>
            </div>
          ) : (
            <div className="real-test-empty">
              <FileText size={24} />
              <strong>先导入一条真实收藏</strong>
              <span>生成后这里会自动带出分类、摘要、关键词、实体和下一步行动，不需要你手动复制。</span>
            </div>
          )}
        </section>
      </div>

      <section className="tool-panel real-test-evaluation">
        <PanelTitle index="3" title="我做快速评价" />
        {currentRecord ? (
          <div className="real-test-eval-grid">
            <RatingGroup title="分类是否准确" options={classificationOptions} value={currentRecord.classificationRating} testPrefix="real-test-classification" onChange={(value) => patchCurrent({ classificationRating: value })} />
            <RatingGroup title="行动卡是否有用" options={actionCardOptions} value={currentRecord.actionCardRating} testPrefix="real-test-action" onChange={(value) => patchCurrent({ actionCardRating: value })} />
            <RatingGroup title="是否让我知道下一步做什么" options={nextStepOptions} value={currentRecord.nextStepRating} testPrefix="real-test-next-step" onChange={(value) => patchCurrent({ nextStepRating: value })} />
            <RatingGroup title="我是否愿意今天执行" options={willingnessOptions} value={currentRecord.todayWillingness} testPrefix="real-test-today" onChange={(value) => patchCurrent({ todayWillingness: value })} />
            <div className="real-test-search-check">
              <strong>搜索能否找回</strong>
              <div className="real-test-search-row">
                <input data-testid="real-test-search-query" value={currentRecord.searchQuery ?? ""} onChange={(event) => patchCurrent({ searchQuery: event.target.value })} placeholder="我会用什么词搜索它，比如：大理 / 剪辑 / 低卡晚餐 / 封面" />
                <button className="secondary-action" onClick={testSearch} data-testid="real-test-search-button"><Search size={16} /> 测试搜索</button>
              </div>
              <span className={currentRecord.searchFound ? "real-test-search-status found" : "real-test-search-status"} data-testid="real-test-search-status">
                {typeof currentRecord.searchFound === "boolean" ? (currentRecord.searchFound ? "找到了" : "没找到") : "还未测试"}
                {currentRecord.searchMatchReason ? ` · ${currentRecord.searchMatchReason}` : ""}
              </span>
            </div>
            <RatingGroup title="完成奖励是否有爽感" options={rewardOptions} value={currentRecord.rewardRating} testPrefix="real-test-reward" onChange={(value) => patchCurrent({ rewardRating: value })} />
            <label className="real-test-issue-field">
              <span>问题记录，可选</span>
              <textarea data-testid="real-test-issue-note" value={currentRecord.issueNote ?? ""} onChange={(event) => patchCurrent({ issueNote: event.target.value })} placeholder="哪里不准、哪里没用、哪里麻烦，可以随便写一句" />
            </label>
            <div className="real-test-save-row">
              <button className="primary-button" onClick={saveCurrent} data-testid="real-test-save"><CheckCircle2 size={16} /> 保存这条试用记录</button>
              <span>记录会自动保存在本地，刷新页面也不会丢。</span>
            </div>
          </div>
        ) : (
          <div className="real-test-empty compact">
            <Clipboard size={22} />
            <strong>生成第一条记录后，就可以用按钮快速评价。</strong>
          </div>
        )}
      </section>

      <section className="tool-panel real-test-export-panel">
        <div>
          <PanelTitle index="导出" title="试用总结" />
          <p className="quiet-copy">导出内容会包含试用记录、统计汇总和系统自动整理出的主要问题，适合继续交给 ChatGPT / Codex 迭代。</p>
        </div>
        <div className="real-test-export-actions">
          <button className="secondary-action" onClick={exportMarkdown} data-testid="real-test-export-md"><Download size={16} /> 导出为 Markdown</button>
          <button className="secondary-action" onClick={exportJson} data-testid="real-test-export-json"><FileJson size={16} /> 导出为 JSON</button>
          <button className="primary-button" onClick={copySummary} data-testid="real-test-copy-summary"><Clipboard size={16} /> 复制试用总结</button>
        </div>
      </section>

      <section className="tool-panel real-test-records-panel">
        <div className="section-heading-soft">
          <span><Clipboard size={18} /> 试用记录</span>
          <small>{records.length} 条</small>
        </div>
        {records.length > 0 ? (
          <div className="real-test-record-list">
            {records.map((record, index) => (
              <article key={record.id} className={currentRecord?.id === record.id ? "real-test-record active" : "real-test-record"} data-testid="real-test-record">
                <div>
                  <div className="row-meta">
                    <span>#{records.length - index}</span>
                    <span>{record.category}</span>
                    <span>{formatRecordDate(record.createdAt)}</span>
                  </div>
                  <h3>{record.title}</h3>
                  <p>{record.issueNote || "还没有问题记录"}</p>
                  <div className="real-test-record-tags">
                    <span>分类：{record.classificationRating ? classificationLabels[record.classificationRating] : "未评"}</span>
                    <span>行动卡：{record.actionCardRating ? actionCardLabels[record.actionCardRating] : "未评"}</span>
                    <span>搜索：{typeof record.searchFound === "boolean" ? (record.searchFound ? "能找回" : "不能找回") : "未测"}</span>
                    <span>今日：{record.todayWillingness ? willingnessLabels[record.todayWillingness] : "未评"}</span>
                  </div>
                </div>
                <div className="real-test-record-actions">
                  <button onClick={() => props.viewActionCard(record.savedItemId)}>查看行动卡</button>
                  <button onClick={() => props.openSource(props.savedItems.find((item) => item.id === record.savedItemId) ?? recordToSavedItem(record, props.userId))}>打开原帖</button>
                  <button onClick={() => setCurrentRecordId(record.id)}>编辑评价</button>
                  <button className="danger-mini" onClick={() => deleteRecord(record.id)}><Trash2 size={15} /> 删除记录</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="real-test-empty compact">
            <Clipboard size={22} />
            <strong>还没有试用记录。</strong>
            <span>从上方导入第一条真实收藏开始。</span>
          </div>
        )}
      </section>
    </div>
  );
}

function RatingGroup<T extends string>(props: {
  title: string;
  options: Array<{ value: T; label: string }>;
  value?: T;
  testPrefix: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rating-group">
      <strong>{props.title}</strong>
      <div>
        {props.options.map((option) => (
          <button key={option.value} className={props.value === option.value ? "active" : ""} onClick={() => props.onChange(option.value)} data-testid={`${props.testPrefix}-${option.value}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelTitle(props: { index: string; title: string }) {
  return (
    <div className="real-test-panel-title">
      <span>{props.index}</span>
      <strong>{props.title}</strong>
    </div>
  );
}

function RealTestStat(props: { label: string; value: string; testId: string }) {
  return (
    <div className="real-test-stat" data-testid={props.testId}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function loadRealTestRecords(storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): RealUserTestRecord[] {
  try {
    const raw = storage?.getItem(REAL_TEST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RealUserTestRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRealTestRecords(records: RealUserTestRecord[], storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage) {
  storage?.setItem(REAL_TEST_STORAGE_KEY, JSON.stringify(records));
}

function normalizeInput(input: ShareInput): ShareInput {
  return {
    sourceUrl: input.sourceUrl.trim(),
    title: input.title.trim(),
    rawShareText: input.rawShareText.trim(),
    userNote: input.userNote.trim()
  };
}

function buildRealTestStats(records: RealUserTestRecord[]) {
  return {
    testedCount: records.length,
    classificationAccuracy: ratio(records.filter((record) => record.classificationRating === "accurate").length, records.filter((record) => record.classificationRating).length),
    actionCardUsefulRate: ratio(records.filter((record) => record.actionCardRating === "useful").length, records.filter((record) => record.actionCardRating).length),
    nextStepClearRate: ratio(records.filter((record) => record.nextStepRating === "clear").length, records.filter((record) => record.nextStepRating).length),
    searchRecallRate: ratio(records.filter((record) => record.searchFound === true).length, records.filter((record) => typeof record.searchFound === "boolean").length),
    todayWillingRate: ratio(records.filter((record) => record.todayWillingness === "willing").length, records.filter((record) => record.todayWillingness).length),
    rewardSatisfactionRate: ratio(records.filter((record) => record.rewardRating === "satisfying").length, records.filter((record) => record.rewardRating).length)
  };
}

function ratio(count: number, total: number): number | undefined {
  if (!total) return undefined;
  return Math.round((count / total) * 100);
}

function formatPercent(value: number | undefined): string {
  return typeof value === "number" ? `${value}%` : "--";
}

function buildMarkdownExport(records: RealUserTestRecord[], stats: ReturnType<typeof buildRealTestStats>): string {
  const rows = records.map((record, index) => [
    index + 1,
    record.title,
    record.category,
    record.classificationRating ? classificationLabels[record.classificationRating] : "未评",
    record.actionCardRating ? actionCardLabels[record.actionCardRating] : "未评",
    typeof record.searchFound === "boolean" ? (record.searchFound ? "能" : "不能") : "未测",
    record.todayWillingness ? willingnessLabels[record.todayWillingness] : "未评",
    record.issueNote || ""
  ]);

  return `# 收藏复活真实试用报告\n\n## 统计汇总\n\n- 本轮真实试用共测试 ${records.length} 条\n- 分类准确率：${formatPercent(stats.classificationAccuracy)}\n- 行动卡有用率：${formatPercent(stats.actionCardUsefulRate)}\n- 下一步明确率：${formatPercent(stats.nextStepClearRate)}\n- 搜索找回率：${formatPercent(stats.searchRecallRate)}\n- 今日行动意愿：${formatPercent(stats.todayWillingRate)}\n- 完成反馈满意度：${formatPercent(stats.rewardSatisfactionRate)}\n\n## 主要问题\n\n${buildIssueSummary(records).map((item, index) => `${index + 1}. ${item}`).join("\n") || "暂无明显问题。"}\n\n## 试用记录\n\n| 序号 | 标题 | 分类 | 分类评价 | 行动卡评价 | 搜索找回 | 今日意愿 | 问题记录 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`).join("\n")}\n`;
}

function buildCopySummary(records: RealUserTestRecord[], stats: ReturnType<typeof buildRealTestStats>): string {
  const issues = buildIssueSummary(records);
  return `本轮真实试用共测试 ${records.length} 条：\n分类准确率：${formatPercent(stats.classificationAccuracy)}\n行动卡有用率：${formatPercent(stats.actionCardUsefulRate)}\n搜索找回率：${formatPercent(stats.searchRecallRate)}\n今日行动意愿：${formatPercent(stats.todayWillingRate)}\n主要问题：\n${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n") || "1. 暂无明显问题"}\n下一轮建议优先优化：\n${buildNextSuggestions(records).map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}

function buildIssueSummary(records: RealUserTestRecord[]): string[] {
  const issues: string[] = [];
  const wrongClassifications = records.filter((record) => record.classificationRating === "wrong").length;
  const weakActions = records.filter((record) => record.actionCardRating === "useless").length;
  const unclearNextSteps = records.filter((record) => record.nextStepRating === "unclear" || record.nextStepRating === "no").length;
  const missedSearch = records.filter((record) => record.searchFound === false).length;
  const unwilling = records.filter((record) => record.todayWillingness === "unwilling").length;
  if (wrongClassifications) issues.push(`${wrongClassifications} 条内容分类不准确，需要优化分类规则或提示词。`);
  if (weakActions) issues.push(`${weakActions} 条行动卡被评为没用，需要让下一步更具体。`);
  if (unclearNextSteps) issues.push(`${unclearNextSteps} 条内容下一步不够明确。`);
  if (missedSearch) issues.push(`${missedSearch} 条内容无法通过用户真实搜索词找回。`);
  if (unwilling) issues.push(`${unwilling} 条内容没有激发今日执行意愿。`);
  records.map((record) => record.issueNote?.trim()).filter(Boolean).slice(0, 5).forEach((note) => issues.push(note!));
  return issues.slice(0, 8);
}

function buildNextSuggestions(records: RealUserTestRecord[]): string[] {
  const suggestions = [
    "先优化真实试用中失败最多的分类和搜索词。",
    "把评价里反复出现的问题整理成下一版 mock AI 生成规则。"
  ];
  if (records.some((record) => record.searchFound === false)) suggestions.unshift("优先补搜索同义词和实体提取，让真实关键词更容易找回原帖。");
  if (records.some((record) => record.nextStepRating === "no" || record.nextStepRating === "unclear")) suggestions.unshift("优先让行动卡的下一步更短、更具体、更像今天能做的一件事。");
  return Array.from(new Set(suggestions)).slice(0, 3);
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeMarkdownCell(value: unknown): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatRecordDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function recordToSavedItem(record: RealUserTestRecord, userId: string): SavedItem {
  return {
    id: record.savedItemId,
    userId,
    sourcePlatform: /xiaohongshu\.com|xhslink\.com/i.test(record.sourceUrl) ? "xiaohongshu" : "manual",
    sourceUrl: record.sourceUrl,
    rawShareText: record.rawShareText,
    title: record.title,
    userNote: record.userNote,
    category: record.category,
    subCategory: record.subCategory,
    intent: "真实试用记录",
    whyThisCategory: "来自真实试用模式的系统分类结果。",
    summary: record.summary,
    keywords: record.keywords,
    entities: record.entities,
    searchableText: `${record.title} ${record.rawShareText} ${record.userNote} ${record.category} ${record.subCategory} ${record.summary} ${record.keywords.join(" ")}`,
    status: "not_started",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}
