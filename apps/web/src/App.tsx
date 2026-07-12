import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  Filter,
  Flower2,
  Import,
  LayoutDashboard,
  LayoutGrid,
  List,
  Play,
  Plus,
  Search,
  Settings,
  Share2,
  Smartphone,
  Sparkles
} from "lucide-react";
import { cloneTasksForCard, createPlansFromActionCards, generateSmartAlbums, PLAN_TYPE_LABELS } from "@revival/action-card-service";
import { createAiClient, type AiRuntimeStatus } from "@revival/ai-service";
import { extensionItemsToImportItems, processImportBatchAsync, type ImportInputItem, type ProcessImportBatchResult } from "@revival/import-service";
import {
  createInitialDemoData,
  createSearchLog,
  STORAGE_KEY,
  loadAppState,
  persistAppState,
  updateItemStatus
} from "@revival/database";
import { getDailyRevivalRecommendations } from "@revival/recommendation-service";
import { searchSavedItems } from "@revival/search-service";
import { AchievementModal, type AchievementDisplay } from "./components/AchievementModal";
import { RewardConfetti } from "./components/RewardConfetti";
import { ThemePicker } from "./components/ThemePicker";
import { TodayWidgetPreview } from "./components/TodayWidgetPreview";
import { RealTestView } from "./components/RealTestView";
import { ThemeProvider } from "./theme/ThemeProvider";
import { getStoredThemeId, getThemePreset, THEME_STORAGE_KEY, type ThemePresetId } from "./theme/themePresets";
import {
  CATEGORIES,
  STATUS_LABELS,
  type ActionCard,
  type AppState,
  type Category,
  type ExtensionImportPayload,
  type ExtensionScannedItem,
  type ImportBatch,
  type ImportBatchItem,
  type ImportSource,
  type ItemStatus,
  type Plan,
  type RevivalRecommendation,
  type SavedItem,
  type SearchResult,
  type SearchLog,
  type ShareInput,
  type SmartAlbum,
  type Task
} from "@revival/shared-types";

type ViewKey = "welcome" | "dashboard" | "import" | "old-import" | "search" | "pool" | "detail" | "plans" | "albums" | "insights" | "mobile" | "settings" | "real-test" | "qa";
type PoolViewMode = "cards" | "table";
type ImportSuccessResult = { item: SavedItem; card: ActionCard };

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "今日复活", icon: LayoutDashboard },
  { key: "import", label: "导入中心", icon: Import },
  { key: "albums", label: "智能专辑", icon: LayoutGrid },
  { key: "search", label: "搜索找回", icon: Search },
  { key: "pool", label: "收藏池", icon: Archive },
  { key: "plans", label: "计划库", icon: ClipboardList },
  { key: "real-test", label: "真实试用", icon: CheckCircle2 },
  { key: "old-import", label: "旧收藏 Beta", icon: Sparkles },
  { key: "settings", label: "设置", icon: Settings },
  { key: "qa", label: "QA", icon: BarChart3 }
];

const emptyImport: ShareInput = {
  sourceUrl: "",
  title: "",
  rawShareText: "",
  userNote: ""
};

const DISPLAY_STATUS_LABELS: Record<ItemStatus, string> = {
  ...STATUS_LABELS,
  completed: "已复活"
};

const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  manual_single: "新收藏导入",
  extension_scan: "旧收藏扫描",
  batch_links: "批量链接",
  browser_bookmarks: "浏览器书签",
  mobile_share: "手机分享",
  screenshot_ocr: "截图识别",
  other: "其他来源"
};

const IMPORT_STATUS_LABELS: Record<ImportBatch["status"], string> = {
  pending: "等待处理",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
  partially_completed: "部分完成"
};

type AchievementId = "first_revival" | "three_day_streak" | "ten_revivals" | "search_recall" | "plan_finished";
type UnlockedAchievementMap = Partial<Record<AchievementId, string>>;
type OpenSourceOrigin = "direct" | "search";

const ACHIEVEMENTS: AchievementDisplay[] = [
  {
    id: "first_revival",
    title: "第一次复活",
    description: "你完成了第一条行动卡，这条收藏没有继续吃灰。",
    condition: "完成第一张行动卡",
    icon: "flower",
    themeColor: "success"
  },
  {
    id: "three_day_streak",
    title: "连续三天",
    description: "连续三天完成至少一条行动，收藏开始变成你的节奏。",
    condition: "连续三天完成行动",
    icon: "calendar",
    themeColor: "primary"
  },
  {
    id: "ten_revivals",
    title: "收藏不再吃灰",
    description: "你已经累计复活 10 条收藏，行动感正在长出来。",
    condition: "累计完成 10 条行动卡",
    icon: "sparkles",
    themeColor: "accent"
  },
  {
    id: "search_recall",
    title: "原帖找回",
    description: "你通过搜索找回并打开了一条原帖，它没有在收藏夹里走丢。",
    condition: "通过搜索结果打开一次原帖",
    icon: "search",
    themeColor: "primary"
  },
  {
    id: "plan_finished",
    title: "计划完成",
    description: "你完成了一个短计划，收藏开始有了自己的节奏。",
    condition: "完成一个 3 天或 7 天计划",
    icon: "check",
    themeColor: "success"
  }
];

const COMPLETION_MESSAGES = [
  "你复活了一条收藏",
  "这条收藏没有继续吃灰",
  "今天的一步完成了",
  "完结撒花，收藏变成了行动",
  "一条收藏，从“以后再说”变成了“我做到了”"
];

const SEARCH_OPEN_MESSAGES = [
  "找到了，那条被你想起来的收藏",
  "原帖已打开，收藏没有走丢"
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadAppState(typeof window === "undefined" ? undefined : window.localStorage));
  const [activeView, setActiveView] = useState<ViewKey>(() => getInitialView());
  const [importInput, setImportInput] = useState<ShareInput>(emptyImport);
  const [lastImportResult, setLastImportResult] = useState<ImportSuccessResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(state.savedItems[0]?.id);
  const [globalQuery, setGlobalQuery] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [poolQuery, setPoolQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ItemStatus | "all">("all");
  const [poolViewMode, setPoolViewMode] = useState<PoolViewMode>("cards");
  const [toast, setToast] = useState("");
  const [recommendationLimit, setRecommendationLimit] = useState(3);
  const [mobileTab, setMobileTab] = useState<"today" | "search" | "import" | "pool" | "plans" | "settings">("today");
  const [mobileQuery, setMobileQuery] = useState("");
  const [themeId, setThemeId] = useState<ThemePresetId>(() => getStoredThemeId(typeof window === "undefined" ? undefined : window.localStorage));
  const [unlockedAchievements, setUnlockedAchievements] = useState<UnlockedAchievementMap>(() =>
    loadUnlockedAchievements(typeof window === "undefined" ? undefined : window.localStorage)
  );
  const [achievementModal, setAchievementModal] = useState<AchievementDisplay | null>(null);
  const [rewardBurstId, setRewardBurstId] = useState(0);
  const [aiStatus, setAiStatus] = useState<AiRuntimeStatus>({
    mode: "mock",
    providerName: "ServerAIProxy",
    modelName: "mock-fallback",
    apiKeyConfigured: false,
    lastCallStatus: "idle",
    fallbackActive: true
  });
  const aiClient = useMemo(
    () => createAiClient({ generateSmartAlbums, onStatusChange: setAiStatus }),
    []
  );
  const syncStatus = useMemo(() => getSyncRuntimeStatus(import.meta.env as Record<string, unknown>), []);

  useEffect(() => {
    persistAppState(state, typeof window === "undefined" ? undefined : window.localStorage);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    persistUnlockedAchievements(unlockedAchievements, typeof window === "undefined" ? undefined : window.localStorage);
  }, [unlockedAchievements]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".global-search input")?.focus();
      }
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    const payload = readExtensionImportFromHash();
    if (!payload) return;
    importExtensionPayload(payload);
    window.history.replaceState(null, "", window.location.pathname || "/");
  }, []);

  const selectedItem = useMemo(
    () => state.savedItems.find((item) => item.id === selectedItemId) ?? state.savedItems[0],
    [selectedItemId, state.savedItems]
  );

  const selectedCard = useMemo(
    () => (selectedItem ? state.actionCards.find((card) => card.savedItemId === selectedItem.id) : undefined),
    [selectedItem, state.actionCards]
  );

  const recommendations = useMemo(
    () =>
      getDailyRevivalRecommendations({
        savedItems: state.savedItems,
        actionCards: state.actionCards,
        searchLogs: state.searchLogs,
        limit: recommendationLimit
      }),
    [recommendationLimit, state.actionCards, state.savedItems, state.searchLogs]
  );

  const plans = useMemo(
    () => createPlansFromActionCards(state.user.id, state.savedItems, state.actionCards),
    [state.actionCards, state.savedItems, state.user.id]
  );

  const smartAlbums = useMemo(
    () => (state.smartAlbums && state.smartAlbums.length > 0 ? state.smartAlbums : generateSmartAlbums(state.savedItems)),
    [state.savedItems, state.smartAlbums]
  );

  const importBatches = useMemo(
    () => [...(state.importBatches ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.importBatches]
  );

  const importBatchItems = state.importBatchItems ?? [];
  const latestExtensionBatch = importBatches.find((batch) => batch.source === "extension_scan");

  const searchResults = useMemo(
    () => searchSavedItems(submittedSearch, state.savedItems, state.actionCards),
    [state.actionCards, state.savedItems, submittedSearch]
  );

  const mobileResults = useMemo(
    () => searchSavedItems(mobileQuery, state.savedItems, state.actionCards).slice(0, 4),
    [mobileQuery, state.actionCards, state.savedItems]
  );

  const filteredItems = useMemo(() => {
    let items = [...state.savedItems];

    if (categoryFilter !== "all") {
      items = items.filter((item) => item.category === categoryFilter);
    }

    if (statusFilter !== "all") {
      items = items.filter((item) => item.status === statusFilter);
    }

    if (poolQuery.trim()) {
      const ids = new Set(searchSavedItems(poolQuery, items, state.actionCards).map((result) => result.item.id));
      items = items.filter((item) => ids.has(item.id));
    }

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [categoryFilter, poolQuery, state.actionCards, state.savedItems, statusFilter]);

  const insights = useMemo(() => buildInsights(state.savedItems), [state.savedItems]);
  const revivalStats = useMemo(() => buildRevivalStats(state.savedItems), [state.savedItems]);
  const unlockedAchievementDisplays = useMemo(
    () =>
      ACHIEVEMENTS.filter((achievement) => unlockedAchievements[achievement.id as AchievementId])
        .map((achievement) => ({ ...achievement, unlockedAt: unlockedAchievements[achievement.id as AchievementId] }))
        .sort((a, b) => new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime()),
    [unlockedAchievements]
  );

  function runSearch(query: string) {
    const clean = query.trim();
    if (!clean) return;
    const results = searchSavedItems(clean, state.savedItems, state.actionCards);
    setSubmittedSearch(clean);
    setGlobalQuery(clean);
    setActiveView("search");
    setState((current) => ({
      ...current,
      searchLogs: [...current.searchLogs, createSearchLog(current.user.id, clean, results.length)]
    }));
  }

  async function testAiConnection(): Promise<string> {
    const keywords = await aiClient.generateSearchKeywords({
      sourceUrl: "",
      title: "AI connection smoke test",
      rawShareText: "测试 AI provider、fallback 和关键词生成是否可用",
      userNote: "QA probe"
    });
    const status = aiClient.getStatus();
    const reason = status.lastError ? ` · ${status.lastError}` : "";
    return `${status.providerName} · ${status.modelName} · ${status.lastCallStatus}${reason} · keywords: ${keywords.slice(0, 3).join(", ")}`;
  }
  function handleGlobalSearch(event: FormEvent) {
    event.preventDefault();
    runSearch(globalQuery);
  }

  function handleImport(event: FormEvent) {
    event.preventDefault();
    const input = normalizeImportInput(importInput);
    if (!input.sourceUrl && !input.title && !input.rawShareText) {
      setToast("至少需要链接、标题或分享文案中的一项");
      return;
    }

    setIsImporting(true);
    window.setTimeout(() => {
      void runImportPipeline("manual_single", "新收藏导入", [input])
        .then((result) => {
          commitImportResult(result);
          const firstItem = result.importedSavedItems[0];
          if (firstItem) {
            const firstCard = result.actionCards.find((card) => card.savedItemId === firstItem.id);
            setSelectedItemId(firstItem.id);
            if (firstCard) setLastImportResult({ item: firstItem, card: firstCard });
            setActiveView("import");
            window.setTimeout(() => document.getElementById("import-result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          } else {
            setLastImportResult(null);
          }
          setImportInput(emptyImport);
          setToast(result.batch.importedCount > 0 ? "已复活一条收藏" : result.batch.errorMessage || "这条收藏已经在收藏池里了");
        })
        .catch((error) => {
          setToast(error instanceof Error ? error.message : "导入失败，已保留 mock fallback");
        })
        .finally(() => setIsImporting(false));
    }, 420);
  }

  async function importExtensionPayload(payload: ExtensionImportPayload) {
    const scannedItems = normalizeExtensionItems(payload.items);
    if (scannedItems.length === 0) {
      setToast("没有发现可导入的收藏卡片");
      return;
    }

    try {
      const result = await runImportPipeline("extension_scan", "旧收藏扫描 Beta", extensionItemsToImportItems(scannedItems));
      commitImportResult(result);
      setSelectedItemId(result.importedSavedItems[0]?.id);
      setActiveView("old-import");
      setToast(
        result.batch.importedCount > 0
          ? `旧收藏扫描完成：导入 ${result.batch.importedCount} 条，重复 ${result.batch.duplicateCount} 条，生成 ${result.batch.createdAlbumCount} 个专辑候选`
          : "这些扫描结果已经在收藏池里了"
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "旧收藏导入失败，已保留当前数据");
    }
  }

  function runImportPipeline(source: ImportSource, title: string, items: ImportInputItem[]): Promise<ProcessImportBatchResult> {
    return processImportBatchAsync({
      source,
      title,
      items,
      userId: state.user.id,
      existingSavedItems: state.savedItems,
      existingActionCards: state.actionCards,
      existingSmartAlbums: smartAlbums,
      aiProvider: aiClient
    });
  }

  function commitImportResult(result: ProcessImportBatchResult) {
    setState((current) => {
      const savedItems = [...result.importedSavedItems, ...current.savedItems];
      return {
        ...current,
        savedItems,
        actionCards: [...result.actionCards, ...current.actionCards],
        smartAlbums: result.smartAlbumCandidates,
        importBatches: [result.batch, ...(current.importBatches ?? [])],
        importBatchItems: [...result.batchItems, ...(current.importBatchItems ?? [])]
      };
    });
  }
  function continueImport() {
    setImportInput(emptyImport);
    setActiveView("import");
    window.setTimeout(() => document.getElementById("single-import-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  function unlockAchievements(ids: AchievementId[]) {
    const now = new Date().toISOString();
    const newlyUnlocked = ids.filter((id) => !unlockedAchievements[id]);
    if (newlyUnlocked.length === 0) return;

    setUnlockedAchievements((current) => {
      const next = { ...current };
      newlyUnlocked.forEach((id) => {
        next[id] = now;
      });
      return next;
    });

    const firstAchievement = ACHIEVEMENTS.find((achievement) => achievement.id === newlyUnlocked[0]);
    if (firstAchievement) {
      setAchievementModal({ ...firstAchievement, unlockedAt: now });
    }
  }

  function triggerCompletionReward(nextItems: SavedItem[]) {
    const stats = buildRevivalStats(nextItems);
    const achievementIds: AchievementId[] = [];

    if (stats.completedTotal >= 1) achievementIds.push("first_revival");
    if (stats.streakDays >= 3) achievementIds.push("three_day_streak");
    if (stats.completedTotal >= 10) achievementIds.push("ten_revivals");

    setRewardBurstId((current) => current + 1);
    setToast(pickMessage(COMPLETION_MESSAGES));
    unlockAchievements(achievementIds);
  }

  function changeStatus(itemId: string, status: ItemStatus) {
    const previousItem = state.savedItems.find((item) => item.id === itemId);
    const nextItems = updateItemStatus(state.savedItems, itemId, status);

    setState((current) => {
      const savedItems = updateItemStatus(current.savedItems, itemId, status);
      return {
        ...current,
        savedItems,
        smartAlbums: mergeGeneratedSmartAlbums(smartAlbums, savedItems)
      };
    });

    if (status === "completed" && previousItem?.status !== "completed") {
      triggerCompletionReward(nextItems);
    }
  }

  function updateSavedNote(itemId: string, userNote: string) {
    setState((current) => ({
      ...current,
      savedItems: current.savedItems.map((item) =>
        item.id === itemId ? { ...item, userNote, updatedAt: new Date().toISOString() } : item
      )
    }));
  }

  function updateCardField(cardId: string, field: "title" | "goal" | "nextAction", value: string) {
    setState((current) => ({
      ...current,
      actionCards: current.actionCards.map((card) =>
        card.id === cardId ? { ...card, [field]: value, updatedAt: new Date().toISOString() } : card
      )
    }));
  }

  async function regenerateActionCard(itemId: string) {
    const item = state.savedItems.find((entry) => entry.id === itemId);
    const card = state.actionCards.find((entry) => entry.savedItemId === itemId);
    if (!item || !card) {
      setToast("No action card is available to regenerate");
      return;
    }

    setToast("正在重新生成行动卡...");
    const result = await aiClient.classifyAndGenerateActionCard({
      sourceUrl: item.sourceUrl,
      title: item.title,
      rawShareText: item.rawShareText,
      userNote: item.userNote
    });

    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      savedItems: current.savedItems.map((entry) =>
        entry.id === itemId
          ? {
              ...entry,
              category: result.category,
              classificationConfidence: result.confidence,
              intent: result.intent,
              summary: result.summary,
              keywords: result.keywords,
              entities: result.entities,
              searchableText: result.searchableText,
              updatedAt: now
            }
          : entry
      ),
      actionCards: current.actionCards.map((entry) =>
        entry.id === card.id
          ? {
              ...entry,
              category: result.category,
              title: result.actionCard.title,
              goal: result.actionCard.goal,
              nextAction: result.actionCard.nextAction,
              estimatedTime: result.actionCard.estimatedTime,
              difficulty: result.actionCard.difficulty,
              fields: result.actionCard.structuredFields,
              tasks: cloneTasksForCard(entry.id, result.actionCard.tasks),
              updatedAt: now
            }
          : entry
      )
    }));
    setToast(aiClient.getStatus().fallbackActive ? "行动卡已用 mock fallback 重新生成" : "行动卡已用真实 AI 重新生成");
  }

  async function regenerateSmartAlbums() {
    setToast("正在重新整理智能专辑...");
    const generatedAlbums = await aiClient.generateSmartAlbums({ savedItems: state.savedItems, existingAlbums: smartAlbums, now: new Date() });
    setState((current) => ({
      ...current,
      smartAlbums: mergeSmartAlbums(current.smartAlbums ?? [], generatedAlbums)
    }));
    setToast(aiClient.getStatus().fallbackActive ? "智能专辑已用 mock fallback 重新生成" : "智能专辑已用真实 AI 重新生成");
  }

  function updateTaskStatus(cardId: string, taskId: string, status: ItemStatus) {
    setState((current) => ({
      ...current,
      actionCards: current.actionCards.map((card) =>
        card.id === cardId
          ? {
              ...card,
              tasks: card.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
              updatedAt: new Date().toISOString()
            }
          : card
      )
    }));
  }

  function openSource(item: SavedItem, origin: OpenSourceOrigin = "direct") {
    if (!item.sourceUrl.trim()) {
      setToast("这条收藏还没有可打开的原帖链接");
      return;
    }

    if (origin === "search" && submittedSearch) {
      setState((current) => ({
        ...current,
        searchLogs: [...current.searchLogs, createSearchLog(current.user.id, submittedSearch, searchResults.length, item.id)]
      }));
      setToast(pickMessage(SEARCH_OPEN_MESSAGES));
      unlockAchievements(["search_recall"]);
    }
    window.open(item.sourceUrl, "_blank", "noopener,noreferrer");
  }
  function viewActionCard(itemId: string) {
    setSelectedItemId(itemId);
    setActiveView("detail");
  }

  function bulkSetFilteredStatus(status: ItemStatus) {
    const ids = new Set(filteredItems.map((item) => item.id));
    setState((current) => ({
      ...current,
      savedItems: current.savedItems.map((item) =>
        ids.has(item.id) ? { ...item, status, updatedAt: new Date().toISOString() } : item
      )
    }));
    setToast(`已更新 ${ids.size} 条收藏`);
  }

  function copyPlan(plan: Plan) {
    const text = `${plan.title}\n${plan.description}\n\n${plan.tasks
      .slice(0, 12)
      .map((task, index) => `${index + 1}. ${task.title} - ${task.description}`)
      .join("\n")}`;
    void navigator.clipboard?.writeText(text);
    setToast("计划内容已复制");
  }

  function resetDemoData() {
    const demo = createInitialDemoData();
    setState(demo);
    setSelectedItemId(demo.savedItems[0]?.id);
    setSubmittedSearch("");
    setGlobalQuery("");
    setPoolQuery("");
    setUnlockedAchievements({});
    setAchievementModal(null);
    setToast(`已恢复 ${demo.savedItems.length} 条演示数据`);
  }

  function addRealTestImportedRecords(savedItem: SavedItem, actionCard: ActionCard) {
    setState((current) => ({
      ...current,
      savedItems: [savedItem, ...current.savedItems],
      actionCards: [actionCard, ...current.actionCards]
    }));
    setSelectedItemId(savedItem.id);
  }
  function importDemoData() {
    const demo = createInitialDemoData();
    const existingUrls = new Set(state.savedItems.map((item) => item.sourceUrl));
    const newItems = demo.savedItems.filter((item) => !existingUrls.has(item.sourceUrl));
    const newItemIds = new Set(newItems.map((item) => item.id));
    const newCards = demo.actionCards.filter((card) => newItemIds.has(card.savedItemId));

    if (newItems.length === 0) {
      setToast("演示数据已经在收藏池里了");
      return;
    }

    setState((current) => {
      const savedItems = [...newItems, ...current.savedItems];
      return {
        ...current,
        savedItems,
        actionCards: [...newCards, ...current.actionCards],
        smartAlbums: mergeGeneratedSmartAlbums(smartAlbums, savedItems)
      };
    });
    setSelectedItemId(newItems[0]?.id);
    setToast(`已导入 ${newItems.length} 条演示数据`);
  }

  function renameSmartAlbum(albumId: string) {
    const album = smartAlbums.find((entry) => entry.id === albumId);
    if (!album) return;
    const title = window.prompt("给这个智能专辑换个名字", album.title)?.trim();
    if (!title || title === album.title) return;
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((entry) =>
        entry.id === albumId ? { ...entry, title, updatedAt: new Date().toISOString() } : entry
      )
    }));
    setToast("专辑名称已更新");
  }

  function confirmSmartAlbum(albumId: string) {
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((entry) =>
        entry.id === albumId ? { ...entry, status: "confirmed", updatedAt: new Date().toISOString() } : entry
      )
    }));
    setToast("已确认创建智能专辑");
  }

  function archiveSmartAlbum(albumId: string) {
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((entry) =>
        entry.id === albumId ? { ...entry, status: "archived", updatedAt: new Date().toISOString() } : entry
      )
    }));
    setToast("已归档这个专辑候选，收藏本身不会被删除");
  }
  if (activeView === "welcome") {
    return (
      <ThemeProvider themeId={themeId}>
        <WelcomeHero
          onEnterWorkspace={() => setActiveView("dashboard")}
          onStartImport={() => setActiveView("import")}
          onToday={() => setActiveView("dashboard")}
        />
        <RewardConfetti burstId={rewardBurstId} />
        <AchievementModal achievement={achievementModal} onClose={() => setAchievementModal(null)} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider themeId={themeId}>
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActiveView("welcome")}>
          <span className="brand-mark">复</span>
          <span>
            <strong>收藏复活</strong>
            <small>从心动到行动</small>
          </span>
        </button>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={activeView === item.key ? "nav-item active" : "nav-item"} onClick={() => setActiveView(item.key)}>
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

      <main className="main">
        <header className="topbar">
          <form className="global-search" onSubmit={handleGlobalSearch}>
            <Search size={18} />
            <input
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder="搜地点、技能、店名、菜名、工具名，找回你收藏过的原帖"
              aria-label="全局搜索"
            />
            <kbd className="search-shortcut">Ctrl K</kbd>
            <button type="submit">搜索</button>
          </form>

          <div className="topbar-actions">
            <button className="icon-text-button" onClick={() => setActiveView("import")}>
              <Share2 size={17} />
              复活一条
            </button>
            <div className="user-chip">{state.user.name}</div>
          </div>
        </header>

        <section className="content">
          {activeView === "dashboard" && (
            <DashboardView
              recommendations={recommendations}
              recentItems={state.savedItems.slice(0, 5)}
              recentSearches={[...state.searchLogs].slice(-4).reverse()}
              actionCards={state.actionCards}
              plans={plans}
              insights={insights}
              revivalStats={revivalStats}
              achievements={unlockedAchievementDisplays}
              onOpenWorkspace={() => setActiveView("dashboard")}
              importInput={importInput}
              setImportInput={setImportInput}
              handleImport={handleImport}
              isImporting={isImporting}
              openSource={openSource}
              viewActionCard={viewActionCard}
              changeStatus={changeStatus}
            />
          )}

          {activeView === "import" && (
            <ImportView
              importInput={importInput}
              setImportInput={setImportInput}
              handleImport={handleImport}
              isImporting={isImporting}
              importBatches={importBatches}
              setActiveView={setActiveView}
              lastImportResult={lastImportResult}
              aiStatus={aiStatus}
              changeStatus={changeStatus}
              viewActionCard={viewActionCard}
              onContinueImport={continueImport}
            />
          )}

          {activeView === "old-import" && (
            <OldImportView
              latestBatch={latestExtensionBatch}
              batchItems={importBatchItems}
              setActiveView={setActiveView}
              recommendations={recommendations}
              changeStatus={changeStatus}
            />
          )}

          {activeView === "search" && (
            <SearchView
              query={submittedSearch}
              results={searchResults}
              runSearch={runSearch}
              openSource={openSource}
              viewActionCard={viewActionCard}
              changeStatus={changeStatus}
            />
          )}

          {activeView === "pool" && (
            <PoolView
              items={filteredItems}
              allItems={state.savedItems}
              actionCards={state.actionCards}
              poolQuery={poolQuery}
              setPoolQuery={setPoolQuery}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              poolViewMode={poolViewMode}
              setPoolViewMode={setPoolViewMode}
              openSource={openSource}
              viewActionCard={viewActionCard}
              changeStatus={changeStatus}
              bulkSetFilteredStatus={bulkSetFilteredStatus}
            />
          )}

          {activeView === "detail" && selectedItem && selectedCard && (
            <DetailView
              item={selectedItem}
              card={selectedCard}
              openSource={openSource}
              changeStatus={changeStatus}
              updateSavedNote={updateSavedNote}
              updateCardField={updateCardField}
              updateTaskStatus={updateTaskStatus}
              regenerateActionCard={regenerateActionCard}
              setActiveView={setActiveView}
              onContinueImport={continueImport}
            />
          )}

          {activeView === "detail" && (!selectedItem || !selectedCard) && (
            <EmptyState title="还没有可查看的行动卡" text="先导入一条收藏，系统会生成行动卡和搜索索引。" />
          )}

          {activeView === "plans" && (
            <PlansView plans={plans} actionCards={state.actionCards} savedItems={state.savedItems} viewActionCard={viewActionCard} copyPlan={copyPlan} />
          )}

          {activeView === "albums" && (
            <SmartAlbumsView
              albums={smartAlbums}
              savedItems={state.savedItems}
              actionCards={state.actionCards}
              viewActionCard={viewActionCard}
              openSource={openSource}
              renameAlbum={renameSmartAlbum}
              confirmAlbum={confirmSmartAlbum}
              archiveAlbum={archiveSmartAlbum}
              regenerateSmartAlbums={regenerateSmartAlbums}
            />
          )}

          {activeView === "insights" && <InsightsView insights={insights} savedItems={state.savedItems} />}

          {activeView === "mobile" && (
            <MobilePrototype
              mobileTab={mobileTab}
              setMobileTab={setMobileTab}
              mobileQuery={mobileQuery}
              setMobileQuery={setMobileQuery}
              mobileResults={mobileResults}
              recommendations={recommendations}
              savedItems={state.savedItems}
              actionCards={state.actionCards}
              plans={plans}
              importInput={importInput}
              setImportInput={setImportInput}
              handleImport={handleImport}
              isImporting={isImporting}
              openSource={openSource}
              viewActionCard={viewActionCard}
              changeStatus={changeStatus}
              recommendationLimit={recommendationLimit}
              setRecommendationLimit={setRecommendationLimit}
            />
          )}

          {activeView === "settings" && (
            <SettingsView
              userName={state.user.name}
              recommendationLimit={recommendationLimit}
              setRecommendationLimit={setRecommendationLimit}
              resetDemoData={resetDemoData}
              themeId={themeId}
              setThemeId={setThemeId}
              aiStatus={aiStatus}
              syncStatus={syncStatus}
            />
          )}

          {activeView === "real-test" && (
            <RealTestView
              userId={state.user.id}
              savedItems={state.savedItems}
              actionCards={state.actionCards}
              onCreateRecords={addRealTestImportedRecords}
              classifyShareInput={(input) => Promise.resolve(aiClient.classifyAndGenerateActionCard(input))}
              openSource={openSource}
              viewActionCard={viewActionCard}
              setToast={setToast}
            />
          )}
          {activeView === "qa" && (
            <QaView
              state={state}
              recommendations={recommendations}
              revivalStats={revivalStats}
              achievements={unlockedAchievementDisplays}
              themeId={themeId}
              aiStatus={aiStatus}
              syncStatus={syncStatus}
              resetDemoData={resetDemoData}
              importDemoData={importDemoData}
              runSearch={runSearch}
              testAiConnection={testAiConnection}
              openSource={openSource}
              viewActionCard={viewActionCard}
              onOpenRealTest={() => setActiveView("real-test")}
            />
          )}
        </section>

        {toast && <div className="toast">{toast}</div>}
        <RewardConfetti burstId={rewardBurstId} />
        <AchievementModal achievement={achievementModal} onClose={() => setAchievementModal(null)} />
      </main>
    </div>
    </ThemeProvider>
  );
}

function WelcomeHero(props: { onEnterWorkspace: () => void; onStartImport: () => void; onToday: () => void }) {
  const [spotlight, setSpotlight] = useState({ x: 66, y: 36 });
  const demoItems = [
    { source: "深圳周末路线", meta: "小红书链接", action: "今天先选 1 个街区", time: "15分钟" },
    { source: "剪辑教程", meta: "想学但一直没开始", action: "拆解一个开头 3 秒", time: "20分钟" },
    { source: "低卡晚餐", meta: "适合本周尝试", action: "先补齐 4 样食材", time: "18分钟" }
  ];

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setSpotlight({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100
    });
  }

  const spotlightStyle = {
    "--revive-x": `${spotlight.x}%`,
    "--revive-y": `${spotlight.y}%`
  } as React.CSSProperties;

  return (
    <main className="welcome-screen">
      <nav className="welcome-nav" aria-label="产品导航">
        <button className="welcome-brand" onClick={props.onEnterWorkspace}>
          <span className="brand-mark">复</span>
          <span>
            <strong>收藏复活</strong>
            <small>把收藏夹变成行动计划</small>
          </span>
        </button>
        <div className="welcome-nav-actions">
          <button className="welcome-link-button" onClick={props.onEnterWorkspace}>进入工作台</button>
          <button className="welcome-outline-button" onClick={props.onStartImport}>模拟分享</button>
        </div>
      </nav>

      <section className="welcome-hero">
        <div className="welcome-copy reveal-up">
          <span className="welcome-kicker"><Sparkles size={16} /> AI 收藏行动助手</span>
          <h1>别让收藏夹替你努力</h1>
          <p>把小红书里那些想学、想去、想做、想试的内容，变成今天可以开始的一步。</p>
          <div className="welcome-cta-row">
            <button className="welcome-primary-button" onClick={props.onStartImport}>
              <Share2 size={18} />
              复活一条收藏
            </button>
            <button className="welcome-secondary-button" onClick={props.onToday}>
              <Play size={17} />
              看看今日行动
            </button>
          </div>
          <div className="welcome-proof-row" aria-label="产品能力">
            <span>自动分类</span>
            <span>行动卡</span>
            <span>找回原帖</span>
            <span>今日 1-3 条</span>
          </div>
        </div>

        <div className="revival-demo reveal-up delay-1" onPointerMove={handlePointerMove} style={spotlightStyle}>
          <div className="revival-demo-glow" aria-hidden="true" />
          <div className="demo-column dusty-column">
            <span className="demo-label">吃灰收藏</span>
            {demoItems.map((item, index) => (
              <article className="dust-card" style={{ "--stagger": index } as React.CSSProperties} key={item.source}>
                <div className="dust-card-top">
                  <span>{item.meta}</span>
                  <small>以后再说</small>
                </div>
                <strong>{item.source}</strong>
                <p>收藏了，但还没有变成下一步。</p>
              </article>
            ))}
          </div>

          <div className="revival-bridge" aria-hidden="true">
            <Sparkles size={18} />
            <span />
          </div>

          <div className="demo-column action-column">
            <span className="demo-label active">复活后</span>
            {demoItems.map((item, index) => (
              <article className="revived-card" style={{ "--stagger": index } as React.CSSProperties} key={item.action}>
                <div className="revived-meta">
                  <span>行动卡</span>
                  <small>{item.time}</small>
                </div>
                <strong>{item.action}</strong>
                <p>先做一个很小的动作，让收藏重新动起来。</p>
                <div>
                  <button>开始行动</button>
                  <button>打开原帖</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
function DashboardView(props: {
  recommendations: RevivalRecommendation[];
  recentItems: SavedItem[];
  recentSearches: SearchLog[];
  actionCards: ActionCard[];
  plans: Plan[];
  insights: ReturnType<typeof buildInsights>;
  revivalStats: ReturnType<typeof buildRevivalStats>;
  achievements: AchievementDisplay[];
  onOpenWorkspace: () => void;
  importInput: ShareInput;
  setImportInput: (input: ShareInput) => void;
  handleImport: (event: FormEvent) => void;
  isImporting: boolean;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
}) {
  return (
    <div className="dashboard-redesign">
      <section className="dashboard-hero-v3 reveal-up">
        <div className="dashboard-hero-copy-v3">
          <span className="welcome-kicker"><Sparkles size={16} /> 今日复活</span>
          <h1>今天，从一条收藏开始</h1>
          <p>不用翻收藏夹，系统每天帮你挑 1-3 条可以真正行动的内容。</p>
          <div className="dashboard-search-prompt" aria-label="全局搜索提示">
            <Search size={18} />
            <span>搜地点、技能、店名、菜名、工具名，找回你收藏过的原帖</span>
            <kbd>Ctrl K</kbd>
          </div>
        </div>

        <div className="dashboard-stat-grid" aria-label="复活数据摘要">
          <StatCard label="已复活总数" value={`${props.revivalStats.completedTotal} 条`} hint="真正完成过的收藏" tone="green" />
          <StatCard label="本周复活" value={`${props.revivalStats.weeklyCompleted} 条`} hint="这周已经动起来" />
          <StatCard label="连续行动" value={`${props.revivalStats.streakDays} 天`} hint="保持轻轻的节奏" tone="warm" />
          <StatCard label="复活值" value={`+${props.revivalStats.revivalValue}`} hint="每完成一条 +1" />
        </div>
      </section>

      <div className="dashboard-action-grid-v3">
        <section className="today-revival-board reveal-up delay-1">
          <div className="section-heading-soft">
            <span><Sparkles size={18} /> 今日复活</span>
            <small>少一点整理，多一点开始</small>
          </div>
          <div className="recommendation-list action-card-stack">
            {props.recommendations.length > 0 ? (
              props.recommendations.map((recommendation) => (
                <RecommendationRow
                  key={recommendation.item.id}
                  recommendation={recommendation}
                  openSource={props.openSource}
                  viewActionCard={props.viewActionCard}
                  changeStatus={props.changeStatus}
                />
              ))
            ) : (
              <EmptyState title="今天没有待复活收藏" text="导入一条新收藏，系统会帮你生成今天可以做的一步。" />
            )}
          </div>
        </section>

        <section className="quick-revive-board reveal-up delay-2">
          <div className="section-heading-soft">
            <span><Share2 size={18} /> 复活一条新收藏</span>
            <small>分享入口预留，先用模拟导入跑通</small>
          </div>
          <p className="panel-intro">把刚刚心动的链接放进来，系统会自动判断它适合学习、出行、做饭、探店还是创作。</p>
          <QuickImportForm input={props.importInput} setInput={props.setImportInput} onSubmit={props.handleImport} isLoading={props.isImporting} compact />
        </section>
      </div>

      <div className="dashboard-lower-panels reveal-up delay-3">
        <section className="soft-panel-v3">
          <PanelHeader icon={<Clock3 size={18} />} title="最近复活" meta={`${props.recentItems.length} 条`} />
          <div className="compact-list">
            {props.recentItems.map((item) => {
              const card = props.actionCards.find((entry) => entry.savedItemId === item.id);
              return (
                <button key={item.id} className="compact-row" onClick={() => props.viewActionCard(item.id)}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.category} · {DISPLAY_STATUS_LABELS[item.status]}</small>
                  </span>
                  <span className="mini-time">{formatDate(item.createdAt)}</span>
                  {card && <small>{item.status === "completed" ? "这条收藏已经被你真正用过了。" : card.nextAction}</small>}
                </button>
              );
            })}
            {props.recentItems.length === 0 && <p className="quiet-copy">收藏池还是空的。先复活一条新收藏，Dashboard 就会开始推荐。</p>}
          </div>
        </section>

        <section className="soft-panel-v3">
          <PanelHeader icon={<Search size={18} />} title="最近搜索" meta={`${props.recentSearches.length} 次`} />
          <div className="compact-list search-mini-list">
            {props.recentSearches.length > 0 ? (
              props.recentSearches.map((log) => (
                <div key={log.id} className="plan-mini-row">
                  <strong>{log.query}</strong>
                  <span>{log.resultCount} 条结果 · {formatDate(log.createdAt)}</span>
                </div>
              ))
            ) : (
              <p className="quiet-copy">试试搜一个地点、技能或场景，找回你收藏过的原帖。</p>
            )}
          </div>
        </section>

        <section className="soft-panel-v3 insight-card-v3">
          <PanelHeader icon={<BarChart3 size={18} />} title="收藏主题洞察" meta="本地统计" />
          <div className="metric-grid insight-metrics">
            <Metric label="总收藏" value={props.insights.total.toString()} />
            <Metric label="行动转化" value={`${props.insights.actionRate}%`} />
            <Metric label="最常见" value={props.insights.topCategory || "暂无"} />
          </div>
        </section>
      </div>

      <div className="dashboard-utility-grid reveal-up delay-3">
        <RecentAchievementsPanel achievements={props.achievements} />
        <TodayWidgetPreview recommendations={props.recommendations} onOpenWorkspace={props.onOpenWorkspace} />
      </div>
    </div>
  );
}

function ImportView(props: {
  importInput: ShareInput;
  setImportInput: (input: ShareInput) => void;
  handleImport: (event: FormEvent) => void;
  isImporting: boolean;
  importBatches: ImportBatch[];
  setActiveView: (view: ViewKey) => void;
  lastImportResult: ImportSuccessResult | null;
  aiStatus: AiRuntimeStatus;
  changeStatus: (itemId: string, status: ItemStatus) => void;
  viewActionCard: (itemId: string) => void;
  onContinueImport: () => void;
}) {
  const usingMock = props.aiStatus.mode === "mock" || props.aiStatus.fallbackActive;
  const methods: Array<{ title: string; description: string; action: string; secondaryAction?: string; status: string; primary: boolean; onClick?: () => void; onSecondaryClick?: () => void }> = [
    {
      title: "新收藏导入",
      description: "如果你是第一次测试，先导入一条真实收藏。只要有链接，再补一个标题或分享文案，就能生成行动卡。",
      action: "复活一条新收藏",
      status: "主入口",
      primary: true,
      onClick: () => document.getElementById("single-import-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })
    },
    {
      title: "旧收藏扫描 Beta",
      description: "高级测试功能，需要先安装本地浏览器扩展 Beta。普通朋友测试可以先跳过。",
      action: "我已安装扩展，去旧收藏扫描页",
      secondaryAction: "查看扩展安装说明",
      status: "高级测试功能",
      primary: false,
      onClick: () => props.setActiveView("old-import"),
      onSecondaryClick: () => props.setActiveView("old-import")
    },
    {
      title: "批量链接导入",
      description: "一次粘贴多条链接，系统自动拆分、去重、分类。",
      action: "Coming soon",
      status: "Coming soon",
      primary: false,
      onClick: undefined
    },
    {
      title: "浏览器书签导入",
      description: "后续支持 Chrome / Edge 书签导入，把网页收藏整理成行动卡。",
      action: "Coming soon",
      status: "Coming soon",
      primary: false,
      onClick: undefined
    },
    {
      title: "手机分享入口",
      description: "未来在手机小红书里点击分享，选择收藏复活 App。",
      action: "Coming soon",
      status: "Coming soon",
      primary: false,
      onClick: undefined
    }
  ];

  return (
    <>
      <div className="page-title-row airy-title">
        <div>
          <p className="eyebrow">导入中心</p>
          <h1>先导入一条真实收藏</h1>
        </div>
        <p className="page-lead">朋友测试建议从新收藏导入开始：导入一条收藏，看行动卡是否具体，再去智能专辑和搜索里验证能不能找回原帖。</p>
      </div>

      {props.lastImportResult && (
        <section id="import-result-panel" className="tool-panel single import-success-panel" data-testid="import-success-panel">
          <div className="section-heading-soft">
            <span><CheckCircle2 size={18} /> 已复活一条收藏</span>
            <small>{props.lastImportResult.item.category} · {props.lastImportResult.card.estimatedTime}</small>
          </div>
          <div className="import-success-body">
            <strong>{props.lastImportResult.card.title}</strong>
            <p>{props.lastImportResult.card.nextAction}</p>
            {props.lastImportResult.item.classificationConfidence === "low" && (
              <p className="quiet-copy">这条收藏信息较少，分类可能不准，可以补充一句备注后重新生成。</p>
            )}
            {usingMock && (
              <p className="quiet-copy">当前使用：本地规则 / Mock AI。生成质量可能有限，配置真实 AI 后分类和行动卡会更具体。</p>
            )}
          </div>
          <div className="card-actions">
            <button className="primary-button" onClick={props.onContinueImport} data-testid="continue-import">继续导入一条</button>
            <button className="secondary-action" onClick={() => props.setActiveView("import")}>回到导入中心</button>
            <button className="secondary-action" onClick={() => props.setActiveView("albums")}>查看智能专辑</button>
            <button className="secondary-action" onClick={() => props.changeStatus(props.lastImportResult!.item.id, "today")}>加入今日复活</button>
            <button className="ghost-action" onClick={() => props.viewActionCard(props.lastImportResult!.item.id)}>查看行动卡</button>
          </div>
        </section>
      )}

      <div className="import-method-grid">
        {methods.map((method) => (
          <article className="import-method-card" key={method.title}>
            <span>{method.status}</span>
            <strong>{method.title}</strong>
            <p>{method.description}</p>
            <button className={method.primary ? "primary-button" : "secondary-action"} onClick={method.onClick} disabled={!method.onClick}>
              {method.action}
            </button>
            {method.secondaryAction && (
              <button className="ghost-action" onClick={method.onSecondaryClick}>{method.secondaryAction}</button>
            )}
          </article>
        ))}
      </div>

      <section id="single-import-panel" className="tool-panel single revive-panel import-page-panel">
        <div className="section-heading-soft">
          <span><Share2 size={18} /> 复活一条新收藏</span>
          <small>第一次测试，先从这里开始</small>
        </div>
        {usingMock && <p className="quiet-copy">当前使用：本地规则 / Mock AI。它能跑通流程，但真实 AI 会让分类和行动卡更贴近原帖主题。</p>}
        <QuickImportForm input={props.importInput} setInput={props.setImportInput} onSubmit={props.handleImport} isLoading={props.isImporting} />
      </section>

      <section className="tool-panel single import-batches-panel">
        <PanelHeader icon={<Clock3 size={18} />} title="最近导入记录" meta={`${props.importBatches.length} 批`} />
        <div className="import-batch-list">
          {props.importBatches.slice(0, 6).map((batch) => (
            <article key={batch.id} className="import-batch-row" data-testid="import-batch-row">
              <div>
                <strong>{batch.title}</strong>
                <small>{IMPORT_SOURCE_LABELS[batch.source]} · {formatDate(batch.createdAt)} · {IMPORT_STATUS_LABELS[batch.status]}</small>
              </div>
              <span>扫描 {batch.rawCount}</span>
              <span>导入 {batch.importedCount}</span>
              <span>重复 {batch.duplicateCount}</span>
              <span>失败 {batch.failedCount}</span>
              <span>行动卡 {batch.createdActionCardCount}</span>
              <span>专辑 {batch.createdAlbumCount}</span>
              <button onClick={() => props.setActiveView(batch.source === "extension_scan" ? "old-import" : "albums")}>查看详情</button>
            </article>
          ))}
          {props.importBatches.length === 0 && <EmptyState title="还没有导入记录" text="先导入一条真实收藏；旧收藏扫描需要本地扩展 Beta，普通朋友测试可以先跳过。" />}
        </div>
      </section>
    </>
  );
}
function OldImportView(props: {
  latestBatch?: ImportBatch;
  batchItems: ImportBatchItem[];
  setActiveView: (view: ViewKey) => void;
  recommendations: RevivalRecommendation[];
  changeStatus: (itemId: string, status: ItemStatus) => void;
}) {
  const items = props.latestBatch ? props.batchItems.filter((item) => item.batchId === props.latestBatch?.id) : [];
  return (
    <>
      <div className="page-title-row airy-title">
        <div>
          <p className="eyebrow">旧收藏扫描 Beta · 高级测试功能</p>
          <h1>把旧收藏先整理成专辑</h1>
        </div>
        <p className="page-lead">当前功能需要先安装本地浏览器扩展 Beta。它不是 Chrome / Edge 商店正式扩展，普通测试用户可以先不用这个功能，直接从新收藏导入开始。</p>
      </div>

      <section className="extension-import-guide" data-testid="old-import-extension-warning">
        <div>
          <span><Sparkles size={18} /> 需要本地扩展 Beta</span>
          <strong>这个页面只接收浏览器扩展传来的扫描结果，网页本身不会读取你的小红书收藏夹。</strong>
          <small>扩展只在你本人登录的小红书网页版、你主动点击扫描后，读取当前已加载 DOM 中的标题、链接、封面地址和可见短文本。不做云端爬虫，不模拟登录，不绕过验证码。</small>
        </div>
        <code>apps/extension</code>
      </section>

      <section className="tool-panel single">
        <div className="section-heading-soft">
          <span><ClipboardList size={18} /> 扩展 Beta 安装步骤</span>
          <small>只适合愿意安装本地 unpacked 扩展的高级测试者</small>
        </div>
        <details className="quiet-copy" open>
          <summary>查看安装说明</summary>
          <ol>
            <li>下载或找到项目里的 apps/extension 构建包。</li>
            <li>打开 Chrome / Edge 扩展管理页。</li>
            <li>开启开发者模式。</li>
            <li>选择“加载已解压扩展”，加载扩展目录。</li>
            <li>打开本人小红书网页版收藏夹。</li>
            <li>点击扩展扫描，确认待导入清单后再导入收藏复活。</li>
          </ol>
        </details>
      </section>

      <div className="old-import-actions">
        <button className="primary-button" onClick={() => props.setActiveView("import")}>没有扩展？先用新收藏导入测试</button>
        <button className="secondary-action" onClick={() => props.setActiveView("albums")}>查看智能专辑</button>
        <button className="secondary-action" onClick={() => props.recommendations.slice(0, 3).forEach((entry) => props.changeStatus(entry.item.id, "today"))}>今日先复活 3 条</button>
      </div>

      <section className="qa-grid">
        <Metric label="扫描数量" value={(props.latestBatch?.rawCount ?? 0).toString()} />
        <Metric label="成功导入" value={(props.latestBatch?.importedCount ?? 0).toString()} />
        <Metric label="重复" value={(props.latestBatch?.duplicateCount ?? 0).toString()} />
        <Metric label="失败" value={(props.latestBatch?.failedCount ?? 0).toString()} />
        <Metric label="生成专辑" value={(props.latestBatch?.createdAlbumCount ?? 0).toString()} />
      </section>

      <section className="tool-panel single import-batches-panel">
        <PanelHeader icon={<List size={18} />} title="最近一次扫描明细" meta={props.latestBatch ? IMPORT_STATUS_LABELS[props.latestBatch.status] : "暂无"} />
        <div className="qa-result-list">
          {items.slice(0, 30).map((item) => (
            <article key={item.id} className="qa-result-row">
              <div>
                <strong>{item.title}</strong>
                <small>{item.status} · {item.sourceUrl || "无链接"}</small>
                <span>{item.errorMessage || item.visibleText || item.rawShareText}</span>
              </div>
              {item.createdSavedItemId && <button onClick={() => props.setActiveView("albums")}>看专辑</button>}
            </article>
          ))}
          {!props.latestBatch && <EmptyState title="还没有旧收藏扫描记录" text="如果没有安装本地扩展 Beta，可以先回到导入中心，手动导入一条真实收藏测试完整闭环。" />}
        </div>
      </section>
    </>
  );
}function SearchView(props: {
  query: string;
  results: SearchResult[];
  runSearch: (query: string) => void;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
}) {
  const [localQuery, setLocalQuery] = useState(props.query);

  useEffect(() => {
    setLocalQuery(props.query);
  }, [props.query]);

  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">找回原帖</p>
          <h1>找回你收藏过的那一条</h1>
        </div>
        <p className="page-lead">搜索的是你主动保存过的分享信息、AI 摘要、关键词和行动卡索引，完整内容仍回到原平台查看。</p>
      </div>

      <form className="search-page-form" onSubmit={(event) => { event.preventDefault(); props.runSearch(localQuery); }}>
        <Search size={18} />
        <input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具" />
        <button type="submit">找回</button>
      </form>

      <div className="result-header">
        <span>{props.query ? `“${props.query}” 的结果` : "等待搜索"}</span>
        <strong>{props.results.length} 条</strong>
      </div>

      <div className="search-results">
        {props.results.map((result) => (
          <SearchResultRow
            key={result.item.id}
            result={result}
            openSource={props.openSource}
            viewActionCard={props.viewActionCard}
            changeStatus={props.changeStatus}
          />
        ))}
        {props.query && props.results.length === 0 && <EmptyState title="还没找到，但这不代表它不存在" text="换个更模糊的词试试，比如地点、技能或场景。" />}
      </div>
    </>
  );
}

function PoolView(props: {
  items: SavedItem[];
  allItems: SavedItem[];
  actionCards: ActionCard[];
  poolQuery: string;
  setPoolQuery: (value: string) => void;
  categoryFilter: Category | "all";
  setCategoryFilter: (value: Category | "all") => void;
  statusFilter: ItemStatus | "all";
  setStatusFilter: (value: ItemStatus | "all") => void;
  poolViewMode: PoolViewMode;
  setPoolViewMode: (value: PoolViewMode) => void;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
  bulkSetFilteredStatus: (status: ItemStatus) => void;
}) {
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">收藏池</p>
          <h1>所有已复活的收藏</h1>
        </div>
        <p className="page-lead">这里管理的是行动卡和索引，不复制原帖完整内容。</p>
      </div>

      <div className="pool-toolbar">
        <label className="field search-field">
          <Search size={17} />
          <input value={props.poolQuery} onChange={(event) => props.setPoolQuery(event.target.value)} placeholder="筛选收藏池" />
        </label>
        <label className="select-field">
          <Filter size={16} />
          <select value={props.categoryFilter} onChange={(event) => props.setCategoryFilter(event.target.value as Category | "all")}>
            <option value="all">全部分类</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <Clock3 size={16} />
          <select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value as ItemStatus | "all")}>
            <option value="all">全部状态</option>
            {Object.entries(DISPLAY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="segmented">
          <button className={props.poolViewMode === "cards" ? "active" : ""} onClick={() => props.setPoolViewMode("cards")} aria-label="卡片视图">
            <LayoutGrid size={17} />
          </button>
          <button className={props.poolViewMode === "table" ? "active" : ""} onClick={() => props.setPoolViewMode("table")} aria-label="表格视图">
            <List size={17} />
          </button>
        </div>
        <button className="icon-text-button" onClick={() => props.bulkSetFilteredStatus("today")}>
          <CalendarCheck size={17} />
          筛选结果加入今日
        </button>
      </div>

      <div className="result-header">
        <span>当前显示</span>
        <strong>{props.items.length} / {props.allItems.length} 条</strong>
      </div>

      {props.poolViewMode === "cards" ? (
        <div className="item-grid">
          {props.items.map((item) => (
            <SavedItemCard
              key={item.id}
              item={item}
              actionCard={props.actionCards.find((card) => card.savedItemId === item.id)}
              openSource={props.openSource}
              viewActionCard={props.viewActionCard}
              changeStatus={props.changeStatus}
            />
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>分类</th>
                <th>状态</th>
                <th>保存时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <small>{item.summary}</small>
                  </td>
                  <td>{item.category}</td>
                  <td>{DISPLAY_STATUS_LABELS[item.status]}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button onClick={() => props.viewActionCard(item.id)}>行动卡</button>
                      <button onClick={() => props.openSource(item)}>原帖</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.items.length === 0 && <EmptyState title="收藏池暂无内容" text="导入一条模拟分享，或者在 /qa 一键导入 demo 数据。" />}
    </>
  );
}

function DetailView(props: {
  item: SavedItem;
  card: ActionCard;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
  updateSavedNote: (itemId: string, userNote: string) => void;
  updateCardField: (cardId: string, field: "title" | "goal" | "nextAction", value: string) => void;
  updateTaskStatus: (cardId: string, taskId: string, status: ItemStatus) => void;
  regenerateActionCard: (itemId: string) => void;
  setActiveView: (view: ViewKey) => void;
  onContinueImport: () => void;
}) {
  return (
    <>
      <div className="detail-hero">
        <div>
          <p className="eyebrow">{props.item.category} · {DISPLAY_STATUS_LABELS[props.item.status]}</p>
          <input className="detail-title-input" value={props.card.title} onChange={(event) => props.updateCardField(props.card.id, "title", event.target.value)} />
          <p>{props.item.summary}</p>
          {props.item.classificationConfidence === "low" && <p className="quiet-copy">这条收藏信息较少，分类可能不准，可以补充一句备注后重新生成。</p>}
        </div>
        <div className="detail-actions">
          <button className="primary-button" onClick={() => props.changeStatus(props.item.id, "today")} data-testid="add-to-today">
            <CalendarCheck size={17} />
            加入今日
          </button>
          <button className="secondary-action" onClick={props.onContinueImport} data-testid="detail-continue-import">继续导入一条</button>
          <button className="secondary-action" onClick={() => props.setActiveView("import")}>回到导入中心</button>
          <button className="secondary-action" onClick={() => props.setActiveView("albums")}>查看智能专辑</button>
          <button className="secondary-action" onClick={() => props.regenerateActionCard(props.item.id)}>Regenerate</button>
          <button className="icon-text-button" onClick={() => props.openSource(props.item)} data-testid="detail-open-source">
            <ExternalLink size={17} />
            打开原帖
          </button>
        </div>
      </div>

      <div className="detail-layout">
        <section className="tool-panel single">
          <PanelHeader icon={<Play size={18} />} title="行动卡" meta={props.card.estimatedTime} />
          <label className="edit-field">
            <span>目标</span>
            <textarea value={props.card.goal} onChange={(event) => props.updateCardField(props.card.id, "goal", event.target.value)} />
          </label>
          <label className="edit-field">
            <span>下一步行动</span>
            <textarea value={props.card.nextAction} onChange={(event) => props.updateCardField(props.card.id, "nextAction", event.target.value)} />
          </label>

          <div className="field-grid">
            {Object.entries(props.card.fields).map(([key, value]) => (
              <div className="field-card" key={key}>
                <span>{key}</span>
                <strong>{formatFieldValue(value)}</strong>
              </div>
            ))}
          </div>
        </section>

        <aside className="detail-side">
          <section className="tool-panel">
            <PanelHeader icon={<CheckCircle2 size={18} />} title="任务" meta={`${props.card.tasks.length} 个`} />
            <div className="task-list">
              {props.card.tasks.map((task) => (
                <TaskRow key={task.id} task={task} onChangeStatus={(status) => props.updateTaskStatus(props.card.id, task.id, status)} />
              ))}
            </div>
          </section>

          <section className="tool-panel">
            <PanelHeader icon={<Archive size={18} />} title="收藏索引" meta={formatDate(props.item.createdAt)} />
            <div className="tag-list">
              {props.item.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
            <div className="entity-list">
              {props.item.entities.map((entity) => <span key={`${entity.type}-${entity.value}`}>{entityLabel(entity.type)}：{entity.value}</span>)}
            </div>
            <label className="edit-field">
              <span>个人备注</span>
              <textarea value={props.item.userNote} onChange={(event) => props.updateSavedNote(props.item.id, event.target.value)} />
            </label>
            <StatusButtons item={props.item} changeStatus={props.changeStatus} />
          </section>
        </aside>
      </div>
    </>
  );
}

function PlansView(props: {
  plans: Plan[];
  actionCards: ActionCard[];
  savedItems: SavedItem[];
  viewActionCard: (itemId: string) => void;
  copyPlan: (plan: Plan) => void;
}) {
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">计划库</p>
          <h1>把同类收藏排成节奏</h1>
        </div>
        <p className="page-lead">第一版自动生成 3 天、7 天或 30 天计划，后续可以接拖拽排序和导出模板。</p>
      </div>

      <div className="plans-grid">
        {props.plans.map((plan) => (
          <section className="plan-panel" key={plan.id}>
            <div className="plan-panel-head">
              <span>{PLAN_TYPE_LABELS[plan.type]}</span>
              <strong>{plan.title}</strong>
              <small>{plan.description}</small>
            </div>
            <div className="plan-card-list">
              {plan.actionCardIds.map((cardId) => {
                const card = props.actionCards.find((item) => item.id === cardId);
                const savedItem = props.savedItems.find((item) => item.id === card?.savedItemId);
                if (!card || !savedItem) return null;
                return (
                  <button key={cardId} onClick={() => props.viewActionCard(savedItem.id)}>
                    <span>{card.category}</span>
                    <strong>{card.title}</strong>
                    <small>{card.nextAction}</small>
                  </button>
                );
              })}
            </div>
            <div className="plan-actions">
              <button onClick={() => props.copyPlan(plan)}>复制计划</button>
              <button onClick={() => window.print()}>打印</button>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function SmartAlbumsView(props: {
  albums: SmartAlbum[];
  savedItems: SavedItem[];
  actionCards: ActionCard[];
  viewActionCard: (itemId: string) => void;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  renameAlbum: (albumId: string) => void;
  confirmAlbum: (albumId: string) => void;
  archiveAlbum: (albumId: string) => void;
  regenerateSmartAlbums: () => void;
}) {
  const visibleAlbums = props.albums.filter((album) => album.status !== "archived");
  const candidateCount = props.albums.filter((album) => album.status === "candidate").length;
  const confirmedCount = props.albums.filter((album) => album.status === "confirmed").length;
  const confirmedItemIds = new Set(props.albums.filter((album) => album.status === "confirmed").flatMap((album) => album.savedItemIds));
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | undefined>(visibleAlbums[0]?.id);
  const selectedAlbum = visibleAlbums.find((album) => album.id === selectedAlbumId) ?? visibleAlbums[0];
  const selectedItems = selectedAlbum
    ? selectedAlbum.savedItemIds
        .map((id) => props.savedItems.find((item) => item.id === id))
        .filter((item): item is SavedItem => Boolean(item))
    : [];

  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">智能整理</p>
          <h1>智能专辑</h1>
        </div>
        <p className="page-lead">大量旧收藏先整理成少量专辑，再挑每个专辑里最值得先复活的 3 条。你不用直接面对几百张卡片。</p>
      </div>

      <section className="album-overview-grid">
        <Metric label="候选专辑" value={candidateCount.toString()} />
        <Metric label="已确认专辑" value={confirmedCount.toString()} />
        <Metric label="待处理收藏" value={Math.max(0, props.savedItems.length - confirmedItemIds.size).toString()} />
      </section>

      <section className="extension-import-guide">
        <div>
          <span><Sparkles size={18} /> 导入 → 整理成专辑 → 选择今日行动</span>
          <strong>旧收藏扫描或手动导入后，都会先进入统一导入管线，再生成专辑候选。</strong>
          <small>完整原帖内容仍然通过 sourceUrl 回到原平台查看，本产品只保存用户确认导入后的索引、摘要和行动卡。</small>
        </div>
        <button className="secondary-action" onClick={props.regenerateSmartAlbums}>Regenerate albums</button>
      </section>

      <div className="smart-album-grid">
        {visibleAlbums.map((album) => {
          const albumItems = album.savedItemIds
            .map((id) => props.savedItems.find((item) => item.id === id))
            .filter((item): item is SavedItem => Boolean(item));
          const priorityItems = albumItems.slice(0, 3);

          return (
            <section className="smart-album-card" key={album.id} data-testid="smart-album-card">
              <div className="smart-album-head">
                <span>{album.category} · {album.status === "confirmed" ? "已确认" : "候选"}</span>
                <strong>{album.title}</strong>
                <small>{album.description}</small>
              </div>
              <div className="tag-list album-keywords">
                {album.keywords.slice(0, 6).map((keyword) => <span key={keyword}>{keyword}</span>)}
              </div>
              <div className="album-priority-list">
                {priorityItems.map((item, index) => {
                  const card = props.actionCards.find((entry) => entry.savedItemId === item.id);
                  return (
                    <article key={item.id}>
                      <em>{index + 1}</em>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{card?.nextAction ?? item.summary}</small>
                      </span>
                      <div>
                        <button onClick={() => props.viewActionCard(item.id)}>查看卡片</button>
                        <button onClick={() => props.openSource(item)}>原帖</button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="album-actions">
                <button className="primary-button" onClick={() => props.confirmAlbum(album.id)} disabled={album.status === "confirmed"} data-testid="confirm-album">
                  {album.status === "confirmed" ? "已确认" : "确认创建"}
                </button>
                <button className="secondary-action" onClick={() => props.renameAlbum(album.id)}>改名</button>
                <button className="secondary-action" onClick={() => setSelectedAlbumId(album.id)}>查看收藏</button>
                <button className="ghost-action" onClick={() => props.archiveAlbum(album.id)} data-testid="archive-album">暂不需要</button>
              </div>
            </section>
          );
        })}
      </div>

      {selectedAlbum && (
        <section className="tool-panel single album-detail-panel" data-testid="album-detail">
          <PanelHeader icon={<LayoutGrid size={18} />} title={`${selectedAlbum.title} · 全部收藏`} meta={`${selectedItems.length} 条`} />
          <div className="qa-result-list">
            {selectedItems.map((item, index) => {
              const card = props.actionCards.find((entry) => entry.savedItemId === item.id);
              return (
                <article key={item.id} className="qa-result-row">
                  <div>
                    <strong>{index + 1}. {item.title}</strong>
                    <small>{item.category} · {DISPLAY_STATUS_LABELS[item.status]}</small>
                    <span>{card?.nextAction ?? item.summary}</span>
                  </div>
                  <div className="qa-row-actions">
                    <button onClick={() => props.viewActionCard(item.id)}>行动卡</button>
                    <button onClick={() => props.openSource(item)}>原帖</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {visibleAlbums.length === 0 && <EmptyState title="还没有智能专辑" text="先从导入中心导入一条收藏，或用旧收藏扫描 Beta 导入一批已加载收藏。" />}
    </>
  );
}
function InsightsView(props: { insights: ReturnType<typeof buildInsights>; savedItems: SavedItem[] }) {
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">数据洞察</p>
          <h1>收藏到行动的转化</h1>
        </div>
        <p className="page-lead">这些统计只基于本产品保存的索引和状态。</p>
      </div>

      <div className="insight-layout">
        <section className="tool-panel">
          <PanelHeader icon={<BarChart3 size={18} />} title="关键指标" meta="MVP" />
          <div className="metric-grid large">
            <Metric label="总收藏" value={props.insights.total.toString()} />
            <Metric label="已完成" value={props.insights.completed.toString()} />
            <Metric label="完成率" value={`${props.insights.completionRate}%`} />
            <Metric label="行动转化率" value={`${props.insights.actionRate}%`} />
          </div>
        </section>

        <section className="tool-panel">
          <PanelHeader icon={<LayoutGrid size={18} />} title="分类分布" meta={props.insights.topCategory || "暂无"} />
          <div className="distribution-list">
            {props.insights.categoryDistribution.map((entry) => (
              <div key={entry.category} className="distribution-row">
                <span>{entry.category}</span>
                <div><i style={{ width: `${entry.percent}%` }} /></div>
                <strong>{entry.count}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="tool-panel wide">
          <PanelHeader icon={<Clock3 size={18} />} title="最近保存" meta={`${props.savedItems.length} 条`} />
          <div className="timeline">
            {props.savedItems.slice(0, 8).map((item) => (
              <div key={item.id}>
                <span>{formatDate(item.createdAt)}</span>
                <strong>{item.title}</strong>
                <small>{item.category} · {DISPLAY_STATUS_LABELS[item.status]}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function MobilePrototype(props: {
  mobileTab: "today" | "search" | "import" | "pool" | "plans" | "settings";
  setMobileTab: (tab: "today" | "search" | "import" | "pool" | "plans" | "settings") => void;
  mobileQuery: string;
  setMobileQuery: (value: string) => void;
  mobileResults: SearchResult[];
  recommendations: RevivalRecommendation[];
  savedItems: SavedItem[];
  actionCards: ActionCard[];
  plans: Plan[];
  importInput: ShareInput;
  setImportInput: (input: ShareInput) => void;
  handleImport: (event: FormEvent) => void;
  isImporting: boolean;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
  recommendationLimit: number;
  setRecommendationLimit: (value: number) => void;
}) {
  return (
    <>
      <div className="page-title-row airy-title">
        <div>
          <p className="eyebrow">手机端 App 原型</p>
          <h1>低摩擦收集，高频轻执行</h1>
        </div>
        <p className="page-lead">手机端重点是顺手分享到 App，然后在今天的 1-3 张卡片里开始行动。</p>
      </div>

      <div className="phone-stage">
        <div className="phone-shell">
          <div className="phone-status">
            <span>9:41</span>
            <span>收藏复活</span>
          </div>

          <div className="phone-hero">
            <p>今天复活哪一条？</p>
            <strong>从一张小卡片开始。</strong>
          </div>

          <label className="phone-search">
            <Search size={16} />
            <input value={props.mobileQuery} onChange={(event) => props.setMobileQuery(event.target.value)} placeholder="搜地点、技能、店名" />
          </label>

          <div className="phone-body">
            {props.mobileTab === "today" && (
              <div className="phone-stack">
                <button className="phone-import-cta" onClick={() => props.setMobileTab("import")}>
                  <Plus size={18} />
                  快速复活一条收藏
                </button>
                <div className="phone-section-title">今日复活</div>
                {props.recommendations.map((recommendation) => (
                  <div className="phone-card" key={recommendation.item.id}>
                    <div className="phone-card-meta">
                      <span>{recommendation.item.category}</span>
                      <span>{recommendation.actionCard.estimatedTime}</span>
                    </div>
                    <strong>{recommendation.actionCard.title}</strong>
                    <p>{recommendation.actionCard.nextAction}</p>
                    <small>{recommendation.reason}</small>
                    <div className="phone-card-actions">
                      <button className="phone-primary" onClick={() => props.changeStatus(recommendation.item.id, "in_progress")}>开始行动</button>
                      <button onClick={() => props.viewActionCard(recommendation.item.id)}>查看</button>
                      <button onClick={() => props.openSource(recommendation.item)} aria-label="打开原帖"><ExternalLink size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {props.mobileTab === "search" && (
              <div className="phone-stack">
                <div className="phone-section-title">找回原帖</div>
                {props.mobileQuery ? (
                  props.mobileResults.map((result) => (
                    <button className="phone-list-row" key={result.item.id} onClick={() => props.viewActionCard(result.item.id)}>
                      <span>{result.item.category}</span>
                      <strong>{result.item.title}</strong>
                      <small>{result.matchReasons[0] || result.item.summary}</small>
                    </button>
                  ))
                ) : (
                  <div className="phone-empty">试试搜：大理、剪辑、低卡晚餐、AI工具。</div>
                )}
              </div>
            )}

            {props.mobileTab === "import" && (
              <div className="phone-stack">
                <div className="phone-section-title">复活一条新收藏</div>
                <QuickImportForm input={props.importInput} setInput={props.setImportInput} onSubmit={props.handleImport} isLoading={props.isImporting} compact />
              </div>
            )}

            {props.mobileTab === "pool" && (
              <div className="phone-stack">
                <div className="phone-section-title">收藏池</div>
                {props.savedItems.slice(0, 7).map((item) => (
                  <button className="phone-list-row" key={item.id} onClick={() => props.viewActionCard(item.id)}>
                    <span>{item.category}</span>
                    <strong>{item.title}</strong>
                    <small>{DISPLAY_STATUS_LABELS[item.status]}</small>
                  </button>
                ))}
              </div>
            )}

            {props.mobileTab === "plans" && (
              <div className="phone-stack">
                <div className="phone-section-title">计划库</div>
                {props.plans.map((plan) => (
                  <div className="phone-list-row" key={plan.id}>
                    <span>{PLAN_TYPE_LABELS[plan.type]}</span>
                    <strong>{plan.title}</strong>
                    <small>{plan.actionCardIds.length} 张行动卡</small>
                  </div>
                ))}
              </div>
            )}

            {props.mobileTab === "settings" && (
              <div className="phone-stack">
                <div className="phone-section-title">我的</div>
                <label className="phone-setting">
                  <span>默认推荐数</span>
                  <select value={props.recommendationLimit} onChange={(event) => props.setRecommendationLimit(Number(event.target.value))}>
                    <option value={1}>1 条</option>
                    <option value={2}>2 条</option>
                    <option value={3}>3 条</option>
                  </select>
                </label>
                <div className="phone-setting muted">账号与同步接口预留</div>
                <div className="phone-setting muted">提醒权限接口预留</div>
              </div>
            )}
          </div>

          <nav className="phone-tabs">
            <button className={props.mobileTab === "today" ? "active" : ""} onClick={() => props.setMobileTab("today")} aria-label="今日">
              <Sparkles size={18} />
              <span>今日</span>
            </button>
            <button className={props.mobileTab === "search" ? "active" : ""} onClick={() => props.setMobileTab("search")} aria-label="搜索">
              <Search size={18} />
              <span>搜索</span>
            </button>
            <button className={props.mobileTab === "pool" ? "active" : ""} onClick={() => props.setMobileTab("pool")} aria-label="收藏池">
              <Archive size={18} />
              <span>收藏</span>
            </button>
            <button className={props.mobileTab === "plans" ? "active" : ""} onClick={() => props.setMobileTab("plans")} aria-label="计划">
              <ClipboardList size={18} />
              <span>计划</span>
            </button>
            <button className={props.mobileTab === "settings" ? "active" : ""} onClick={() => props.setMobileTab("settings")} aria-label="我的">
              <Settings size={18} />
              <span>我的</span>
            </button>
          </nav>
        </div>

        <section className="mobile-notes">
          <PanelHeader icon={<Share2 size={18} />} title="分享入口预留" meta="apps/mobile" />
          <p>未来 iOS Share Extension 和 Android Send Intent 会把系统分享 payload 归一化成同一份 `ShareInput`，再复用当前 AI、搜索和推荐服务。</p>
          <div className="mobile-note-list">
            <span>接收 sourceUrl</span>
            <span>接收分享标题/文案</span>
            <span>允许用户补备注</span>
            <span>生成行动卡后回到今日复活</span>
          </div>
        </section>
      </div>
    </>
  );
}
function SettingsView(props: {
  userName: string;
  recommendationLimit: number;
  setRecommendationLimit: (value: number) => void;
  resetDemoData: () => void;
  themeId: ThemePresetId;
  setThemeId: (themeId: ThemePresetId) => void;
  aiStatus: AiRuntimeStatus;
  syncStatus: SyncRuntimeStatus;
}) {
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">设置</p>
          <h1>本地 MVP 设置</h1>
        </div>
        <p className="page-lead">账号、同步和提醒先保留入口，第一版专注跑通收藏复活闭环。</p>
      </div>

      <ThemePicker selectedThemeId={props.themeId} onThemeChange={props.setThemeId} />

      <section className="tool-panel single settings-list">
        <div className="settings-row">
          <span>AI mode</span>
          <strong>{props.aiStatus.mode === "real" ? "Real AI" : "Mock"}</strong>
        </div>
        <div className="settings-row muted">
          <span>AI provider</span>
          <strong>{props.aiStatus.providerName}</strong>
        </div>
        <div className="settings-row muted">
          <span>AI model</span>
          <strong>{props.aiStatus.modelName}</strong>
        </div>
        <div className="settings-row muted">
          <span>API Key</span>
          <strong>{props.aiStatus.apiKeyConfigured ? "Configured" : "Not configured"}</strong>
        </div>
        <div className="settings-row muted">
          <span>Fallback</span>
          <strong>{props.aiStatus.fallbackActive ? "Mock fallback ready" : "Not active"}</strong>
        </div>
        {(props.aiStatus.mode === "mock" || props.aiStatus.fallbackActive) && (
          <p className="quiet-copy">当前使用：本地规则 / Mock AI。产品闭环可以正常测试，但配置真实 AI 后，分类和行动卡会更具体。</p>
        )}
      </section>

      <section className="tool-panel single settings-list" data-testid="sync-status-panel">
        <div className="settings-row">
          <span>同步状态</span>
          <strong>{props.syncStatus.mode === "local" ? "本地模式" : "云端待验证"}</strong>
        </div>
        <div className="settings-row muted">
          <span>存储位置</span>
          <strong>{props.syncStatus.persistence === "browser-local" ? "当前浏览器 localStorage" : "Supabase 待迁移"}</strong>
        </div>
        <div className="settings-row muted">
          <span>云同步</span>
          <strong>{props.syncStatus.syncEnabled ? "已启用" : "Coming soon"}</strong>
        </div>
        <div className="settings-row muted">
          <span>迁移状态</span>
          <strong>{props.syncStatus.migrationRequired ? "需要用户确认迁移" : "暂不需要迁移"}</strong>
        </div>
        <p className="quiet-copy">{props.syncStatus.message}</p>
      </section>

      <section className="tool-panel single settings-list">
        <div className="settings-row">
          <span>当前账号</span>
          <strong>{props.userName}</strong>
        </div>
        <label className="settings-row">
          <span>今日推荐数量</span>
          <select value={props.recommendationLimit} onChange={(event) => props.setRecommendationLimit(Number(event.target.value))}>
            <option value={1}>1 条</option>
            <option value={2}>2 条</option>
            <option value={3}>3 条</option>
          </select>
        </label>
        <div className="settings-row muted">
          <span>云同步</span>
          <strong>接口预留</strong>
        </div>
        <div className="settings-row muted">
          <span>提醒通知</span>
          <strong>接口预留</strong>
        </div>
        <button className="danger-button" onClick={props.resetDemoData}>恢复演示数据</button>
      </section>
    </>
  );
}

function QaView(props: {
  state: AppState;
  recommendations: RevivalRecommendation[];
  revivalStats: ReturnType<typeof buildRevivalStats>;
  achievements: AchievementDisplay[];
  themeId: ThemePresetId;
  aiStatus: AiRuntimeStatus;
  syncStatus: SyncRuntimeStatus;
  resetDemoData: () => void;
  importDemoData: () => void;
  runSearch: (query: string) => void;
  testAiConnection: () => Promise<string>;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  onOpenRealTest: () => void;
}) {
  const [aiProbeResult, setAiProbeResult] = useState("");
  const [qaQuery, setQaQuery] = useState("剪辑");
  const qaResults = useMemo(
    () => searchSavedItems(qaQuery, props.state.savedItems, props.state.actionCards).slice(0, 6),
    [props.state.actionCards, props.state.savedItems, qaQuery]
  );
  const storageStatus = getStorageStatus(props.state);
  const currentTheme = getThemePreset(props.themeId);

  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">MVP 自检</p>
          <h1>7 天稳定性检查面板</h1>
        </div>
        <p className="page-lead">这个页面用于验收本地 MVP 的数据、搜索、推荐、主题和本地存储状态，不面向最终用户。</p>
      </div>

      <section className="qa-grid">
        <Metric label="SavedItem" value={props.state.savedItems.length.toString()} />
        <Metric label="ActionCard" value={props.state.actionCards.length.toString()} />
        <Metric label="今日推荐" value={props.recommendations.length.toString()} />
        <Metric label="已复活" value={props.revivalStats.completedTotal.toString()} />
        <Metric label="本周复活" value={props.revivalStats.weeklyCompleted.toString()} />
        <Metric label="连续行动" value={`${props.revivalStats.streakDays} 天`} />
        <Metric label="已解锁成就" value={props.achievements.length.toString()} />
        <Metric label="当前主题" value={currentTheme.name.split(" /")[0]} />
        <Metric label="AI" value={props.aiStatus.providerName} />
        <Metric label="Sync" value={props.syncStatus.mode === "local" ? "Local" : "Supabase"} />
      </section>

      <section className="tool-panel single qa-panel" data-testid="qa-ai-panel">
        <PanelHeader icon={<Sparkles size={18} />} title="AI provider probe" meta={props.aiStatus.lastCallStatus} />
        <div className="qa-status-list">
          <span>provider：<strong>{props.aiStatus.providerName}</strong></span>
          <span>model：<strong>{props.aiStatus.modelName}</strong></span>
          <span>fallback：<strong>{props.aiStatus.fallbackActive ? "active" : "not active"}</strong></span>
          <span>key：<strong>{props.aiStatus.apiKeyConfigured ? "server configured" : "not configured / mock"}</strong></span>
        </div>
        <div className="qa-actions">
          <button
            onClick={() => {
              setAiProbeResult("Testing /api/ai...");
              void props.testAiConnection().then(setAiProbeResult).catch((error) => setAiProbeResult(error instanceof Error ? error.message : "AI probe failed"));
            }}
          >
            Test /api/ai
          </button>
          <span>{aiProbeResult || props.aiStatus.lastError || "No AI request has been made in this session."}</span>
        </div>
      </section>
      <section className="tool-panel single qa-panel" data-testid="qa-friend-test-reminder">
        <PanelHeader icon={<ClipboardList size={18} />} title="线上朋友测试提醒" meta="Web MVP" />
        <div className="qa-status-list">
          <span>当前版本：<strong>公开 Web MVP</strong></span>
          <span>数据位置：<strong>当前浏览器 localStorage</strong></span>
          <span>朋友测试：<strong>建议去 /real-test 或 /import</strong></span>
          <span>旧收藏扫描：<strong>需要安装本地扩展 Beta</strong></span>
        </div>
        <p className="quiet-copy">请提醒朋友不要输入隐私内容。完成 3-5 条真实收藏测试后，可以在 /real-test 复制试用总结发回来。</p>
      </section>

      <div className="qa-layout">
        <section className="tool-panel single qa-panel">
          <PanelHeader icon={<CheckCircle2 size={18} />} title="本地存储状态" meta={storageStatus.ok ? "正常" : "需要检查"} />
          <div className="qa-status-list">
            <span>localStorage：<strong>{storageStatus.storageAvailable ? "可写" : "不可写"}</strong></span>
            <span>mock database：<strong>{storageStatus.databaseReadable ? "可读" : "不可读"}</strong></span>
            <span>持久化条数：<strong>{storageStatus.persistedItems} 条</strong></span>
            <span>主题持久化：<strong>{storageStatus.persistedTheme || "默认主题"}</strong></span>
          </div>
          <div className="qa-actions">
            <button className="primary-button" onClick={props.importDemoData} data-testid="qa-import-demo">一键导入 demo 数据</button>
            <button className="danger-button" onClick={props.resetDemoData} data-testid="qa-reset-demo">一键重置 demo 数据</button>
            <button className="secondary-action" onClick={props.onOpenRealTest} data-testid="qa-real-test">进入真实试用模式</button>
          </div>
          <p className="quiet-copy">重置会恢复内置 20 条演示数据，并清空本地成就，适合重新跑完整验收。</p>
        </section>

        <section className="tool-panel single qa-panel">
          <PanelHeader icon={<Search size={18} />} title="搜索功能测试" meta={`${qaResults.length} 条结果`} />
          <form className="search-page-form qa-search-form" onSubmit={(event) => { event.preventDefault(); props.runSearch(qaQuery); }}>
            <Search size={18} />
            <input data-testid="qa-search-input" value={qaQuery} onChange={(event) => setQaQuery(event.target.value)} placeholder="试试：剪辑、大理、低卡晚餐、封面、租房" />
            <button type="submit" data-testid="qa-search-submit">去搜索页查看</button>
          </form>
          <div className="qa-result-list">
            {qaResults.length > 0 ? (
              qaResults.map((result) => (
                <article key={result.item.id} className="qa-result-row">
                  <div>
                    <strong>{result.item.title}</strong>
                    <small>{result.item.category} · {DISPLAY_STATUS_LABELS[result.item.status]}</small>
                    <span>{result.matchReasons.join("，")}</span>
                  </div>
                  <div className="qa-row-actions">
                    <button onClick={() => props.viewActionCard(result.item.id)}>行动卡</button>
                    <button onClick={() => props.openSource(result.item, "search")}>原帖</button>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState title="当前测试词没有结果" text="换成地点、技能、菜名、工具名或场景词再试一次。" />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
function QuickImportForm(props: {
  input: ShareInput;
  setInput: (input: ShareInput) => void;
  onSubmit: (event: FormEvent) => void;
  compact?: boolean;
  isLoading?: boolean;
}) {
  const update = (field: keyof ShareInput, value: string) => props.setInput({ ...props.input, [field]: value });
  const onlyUrlProvided = Boolean(props.input.sourceUrl.trim()) && !props.input.title.trim() && !props.input.rawShareText.trim() && !props.input.userNote.trim();

  return (
    <form className={props.compact ? "quick-import compact" : "quick-import"} onSubmit={props.onSubmit} data-testid="quick-import-form">
      <label>
        <span>分享链接</span>
        <input data-testid="import-source-url" value={props.input.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} placeholder="粘贴小红书分享链接，后续将支持系统分享入口" />
      </label>
      <label>
        <span>标题，可选</span>
        <input data-testid="import-title" value={props.input.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：深圳周末展览路线" />
      </label>
      <label>
        <span>分享文案，可选</span>
        <textarea data-testid="import-raw-share-text" value={props.input.rawShareText} onChange={(event) => update("rawShareText", event.target.value)} placeholder="系统分享面板带过来的可用文本" />
      </label>
      <label>
        <span>个人备注，可选</span>
        <input data-testid="import-user-note" value={props.input.userNote} onChange={(event) => update("userNote", event.target.value)} placeholder="可选，比如：下周末想去 / 想学这个 / 适合拍视频" />
      </label>
      <button className="primary-button" type="submit" disabled={props.isLoading} data-testid="import-submit">
        {props.isLoading ? <span className="loading-dot" aria-hidden="true" /> : <Import size={17} />}
        {props.isLoading ? "正在把收藏变成行动卡..." : "生成行动卡"}
      </button>
      {onlyUrlProvided && <p className="import-hint">只有链接时系统理解会比较弱，建议补一句你为什么收藏它。</p>}
      <p className="import-hint">第一版用模拟分享导入，后续会接入手机系统分享入口。</p>
    </form>
  );
}
function RecommendationRow(props: {
  recommendation: RevivalRecommendation;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
}) {
  const { item, actionCard, reason } = props.recommendation;
  const isCompleted = item.status === "completed";
  return (
    <article className={isCompleted ? "action-row completed-card" : "action-row"} data-testid="recommendation-card">
      <div className="action-main">
        <div className="row-meta">
          <span>{item.category}</span>
          <span>{actionCard.estimatedTime}</span>
          <span>{DISPLAY_STATUS_LABELS[item.status]}</span>
        </div>
        <h3>{actionCard.title}</h3>
        <p>{isCompleted ? "这条收藏已经被你真正用过了。" : actionCard.nextAction}</p>
        <small>{reason}</small>
      </div>
      <div className="row-actions">
        <button className="primary-button" onClick={() => props.changeStatus(item.id, "in_progress")} disabled={isCompleted} data-testid="start-action">
          <Play size={16} />
          {isCompleted ? "已复活" : "开始行动"}
        </button>
        <button className="secondary-action" onClick={() => props.viewActionCard(item.id)} data-testid="view-action-card">查看卡片</button>
        <button className="ghost-action icon-only" onClick={() => props.openSource(item)} aria-label="打开原帖" data-testid="open-source">
          <ExternalLink size={16} />
        </button>
      </div>
    </article>
  );
}
function SavedItemCard(props: {
  item: SavedItem;
  actionCard?: ActionCard;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
}) {
  const isCompleted = props.item.status === "completed";
  return (
    <article className={isCompleted ? "saved-card completed-card" : "saved-card"} data-testid="saved-item-card">
      <div className="row-meta">
        <span>{props.item.category}</span>
        <span>{formatDate(props.item.createdAt)}</span>
      </div>
      <h3>{props.item.title}</h3>
      <p>{props.item.summary}</p>
      <div className="tag-list">
        {props.item.keywords.slice(0, 5).map((keyword) => <span key={keyword}>{keyword}</span>)}
      </div>
      <StatusButtons item={props.item} changeStatus={props.changeStatus} />
      <div className="card-actions">
        <button onClick={() => props.openSource(props.item)} data-testid="open-source">
          <ExternalLink size={16} />
          打开原帖
        </button>
        <button className="primary-button" onClick={() => props.viewActionCard(props.item.id)} data-testid="view-action-card">
          <Play size={16} />
          查看卡片
        </button>
      </div>
      {props.actionCard && <small className="next-action">{isCompleted ? "不是收藏更多，是完成一条。" : props.actionCard.nextAction}</small>}
    </article>
  );
}

function SearchResultRow(props: {
  result: SearchResult;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  changeStatus: (itemId: string, status: ItemStatus) => void;
}) {
  const { item, actionCard, matchReasons } = props.result;
  const isCompleted = item.status === "completed";
  return (
    <article className={isCompleted ? "search-result-row completed-card" : "search-result-row"} data-testid="search-result-card">
      <div>
        <div className="row-meta">
          <span>{item.category}</span>
          <span>{formatDate(item.createdAt)}</span>
          <span>{DISPLAY_STATUS_LABELS[item.status]}</span>
        </div>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        <div className="reason-list">
          {matchReasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
        {actionCard && <small>{isCompleted ? "这条收藏已经被你真正用过了。" : actionCard.nextAction}</small>}
      </div>
      <div className="row-actions search-card-actions">
        <button className="secondary-action" onClick={() => props.openSource(item, "search")} data-testid="open-source-search">
          <ExternalLink size={16} />
          打开原帖
        </button>
        <button className="primary-button" onClick={() => props.viewActionCard(item.id)} data-testid="view-action-card">
          <Play size={16} />
          查看行动卡
        </button>
      </div>
    </article>
  );
}

function StatusButtons(props: { item: SavedItem; changeStatus: (itemId: string, status: ItemStatus) => void }) {
  const statuses: ItemStatus[] = ["not_started", "today", "in_progress", "completed", "snoozed"];
  return (
    <div className="status-buttons">
      {statuses.map((status) => (
        <button key={status} data-testid={`status-${status}`} className={props.item.status === status ? "active" : ""} onClick={() => props.changeStatus(props.item.id, status)}>
          {DISPLAY_STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}

function TaskRow(props: { task: Task; onChangeStatus: (status: ItemStatus) => void }) {
  return (
    <div className="task-row">
      <button className={props.task.status === "completed" ? "task-check done" : "task-check"} onClick={() => props.onChangeStatus(props.task.status === "completed" ? "not_started" : "completed")} aria-label="切换任务完成状态">
        <CheckCircle2 size={17} />
      </button>
      <span>
        <strong>{props.task.title}</strong>
        <small>{props.task.description}</small>
      </span>
      <em>{props.task.estimatedTime}</em>
    </div>
  );
}

function PanelHeader(props: { icon: React.ReactNode; title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <span>{props.icon}</span>
      <strong>{props.title}</strong>
      {props.meta && <small>{props.meta}</small>}
    </div>
  );
}

function RecentAchievementsPanel(props: { achievements: AchievementDisplay[] }) {
  const iconMap = {
    sparkles: Sparkles,
    flower: Flower2,
    check: CheckCircle2,
    search: Search,
    calendar: CalendarCheck
  };
  const visibleAchievements = props.achievements.slice(0, 3);

  return (
    <section className="recent-achievements-panel">
      <div className="section-heading-soft">
        <span><Sparkles size={18} /> 最近成就</span>
        <small>{props.achievements.length} 个已解锁</small>
      </div>
      <div className="achievement-list">
        {visibleAchievements.length > 0 ? (
          visibleAchievements.map((achievement) => {
            const Icon = iconMap[achievement.icon];
            return (
              <article className={`achievement-card ${achievement.themeColor}`} key={achievement.id}>
                <span><Icon size={18} /></span>
                <div>
                  <strong>{achievement.title}</strong>
                  <small>{achievement.description}</small>
                  {achievement.unlockedAt && <em>{formatDate(achievement.unlockedAt)} 解锁</em>}
                </div>
              </article>
            );
          })
        ) : (
          <div className="achievement-empty">
            <Sparkles size={20} />
            <strong>完成第一条行动卡，就会点亮第一个成就。</strong>
            <span>它只是轻轻提醒你：收藏已经开始变成行动。</span>
          </div>
        )}
      </div>
    </section>
  );
}
function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function StatCard(props: { label: string; value: string; hint: string; tone?: "green" | "warm" }) {
  return (
    <div className={props.tone ? `stat-card ${props.tone}` : "stat-card"} data-testid={`stat-${props.label}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.hint}</small>
    </div>
  );
}

function EmptyState(props: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Search size={24} />
      <strong>{props.title}</strong>
      <span>{props.text}</span>
    </div>
  );
}

type SyncRuntimeStatus = {
  mode: "local" | "supabase";
  providerName: string;
  configured: boolean;
  persistence: "browser-local" | "cloud";
  syncEnabled: boolean;
  migrationRequired: boolean;
  message: string;
};

function getSyncRuntimeStatus(env: Record<string, unknown>): SyncRuntimeStatus {
  const supabaseUrl = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const supabaseAnonKey = typeof env.VITE_SUPABASE_ANON_KEY === "string" ? env.VITE_SUPABASE_ANON_KEY.trim() : "";
  const configured = Boolean(supabaseUrl && supabaseAnonKey);

  return {
    mode: configured ? "supabase" : "local",
    providerName: configured ? "Supabase" : "LocalStorage",
    configured,
    persistence: configured ? "cloud" : "browser-local",
    syncEnabled: false,
    migrationRequired: configured,
    message: configured
      ? "检测到 Supabase 环境变量，但云同步仍需完成登录、数据库迁移和 RLS 验证后才能开启。"
      : "当前数据只保存在这个浏览器。换设备、换浏览器或清空 localStorage 后不会自动同步。"
  };
}

type StorageStatus = {
  ok: boolean;
  storageAvailable: boolean;
  databaseReadable: boolean;
  persistedItems: number;
  persistedTheme: string;
};

function getStorageStatus(state: AppState): StorageStatus {
  if (typeof window === "undefined") {
    return {
      ok: false,
      storageAvailable: false,
      databaseReadable: false,
      persistedItems: state.savedItems.length,
      persistedTheme: ""
    };
  }

  try {
    const testKey = "collection-revival-system:qa-write-test";
    window.localStorage.setItem(testKey, "ok");
    window.localStorage.removeItem(testKey);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AppState) : state;
    const persistedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) ?? "";

    return {
      ok: Array.isArray(parsed.savedItems) && Array.isArray(parsed.actionCards),
      storageAvailable: true,
      databaseReadable: Array.isArray(parsed.savedItems) && Array.isArray(parsed.actionCards),
      persistedItems: parsed.savedItems?.length ?? 0,
      persistedTheme
    };
  } catch {
    return {
      ok: false,
      storageAvailable: false,
      databaseReadable: false,
      persistedItems: 0,
      persistedTheme: ""
    };
  }
}
const ACHIEVEMENT_STORAGE_KEY = "collection-revival-achievements";

function loadUnlockedAchievements(storage?: Storage): UnlockedAchievementMap {
  try {
    const raw = storage?.getItem(ACHIEVEMENT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UnlockedAchievementMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistUnlockedAchievements(achievements: UnlockedAchievementMap, storage?: Storage) {
  storage?.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(achievements));
}

function pickMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)] ?? messages[0] ?? "完成了";
}

function buildRevivalStats(items: SavedItem[]) {
  const completed = items.filter((item) => item.status === "completed");
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

  const weeklyCompleted = completed.filter((item) => new Date(item.updatedAt).getTime() >= weekStart.getTime()).length;
  const completedDays = new Set(
    completed.map((item) => {
      const date = new Date(item.updatedAt);
      return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    })
  );

  let streakDays = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  while (completedDays.has(`${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`)) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    completedTotal: completed.length,
    weeklyCompleted,
    streakDays,
    revivalValue: completed.length
  };
}
function readExtensionImportFromHash(): ExtensionImportPayload | null {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#extension-import=")) return null;

  const encoded = window.location.hash.replace("#extension-import=", "");
  try {
    const payload = decodeBase64UrlJson<ExtensionImportPayload>(encoded);
    if (payload?.source !== "browser-extension-poc" || !Array.isArray(payload.items)) return null;
    return payload;
  } catch {
    return null;
  }
}

function decodeBase64UrlJson<T>(encoded: string): T {
  const base64 = decodeURIComponent(encoded).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function normalizeExtensionItems(items: ExtensionScannedItem[]): ExtensionScannedItem[] {
  const seen = new Set<string>();
  return items
    .map((item) => ({
      title: item.title?.trim() || item.visibleText?.trim().slice(0, 42) || "未命名小红书收藏",
      sourceUrl: item.sourceUrl?.trim() ?? "",
      coverUrl: item.coverUrl?.trim() || undefined,
      visibleText: item.visibleText?.trim().slice(0, 280) || undefined,
      sourcePlatform: "xiaohongshu" as const
    }))
    .filter((item) => item.sourceUrl || item.title)
    .filter((item) => {
      const key = `${item.sourceUrl.toLowerCase()}|${item.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function mergeSmartAlbums(existingAlbums: SmartAlbum[], generatedAlbums: SmartAlbum[]): SmartAlbum[] {
  const generatedById = new Map(generatedAlbums.map((album) => [album.id, album]));
  const merged = generatedAlbums.map((album) => {
    const existing = existingAlbums.find((entry) => entry.id === album.id);
    if (!existing) return album;
    return {
      ...album,
      title: existing.title,
      description: existing.description || album.description,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: album.updatedAt
    };
  });

  existingAlbums
    .filter((album) => album.status === "archived" && !generatedById.has(album.id))
    .forEach((album) => merged.push(album));

  return merged.sort((a, b) => b.priority - a.priority || b.savedItemIds.length - a.savedItemIds.length);
}
function mergeGeneratedSmartAlbums(existingAlbums: SmartAlbum[], savedItems: SavedItem[]): SmartAlbum[] {
  const existingById = new Map(existingAlbums.map((album) => [album.id, album]));
  const generated = generateSmartAlbums(savedItems);
  const merged = generated.map((album) => {
    const existing = existingById.get(album.id);
    if (!existing) return album;
    return {
      ...album,
      title: existing.title,
      description: existing.description || album.description,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt: album.updatedAt
    };
  });

  existingAlbums
    .filter((album) => album.status === "archived" && !merged.some((entry) => entry.id === album.id))
    .forEach((album) => merged.push(album));

  return merged.sort((a, b) => b.priority - a.priority || b.savedItemIds.length - a.savedItemIds.length);
}
function getInitialView(): ViewKey {
  if (typeof window === "undefined") return "welcome";
  const view = window.location.pathname.replace(/^\//, "") as ViewKey;
  const supported: ViewKey[] = ["welcome", "dashboard", "import", "old-import", "search", "pool", "detail", "plans", "albums", "insights", "mobile", "settings", "real-test", "qa"];
  return supported.includes(view) ? view : "welcome";
}

function normalizeImportInput(input: ShareInput): ShareInput {
  return {
    sourceUrl: input.sourceUrl.trim(),
    title: input.title.trim(),
    rawShareText: input.rawShareText.trim(),
    userNote: input.userNote.trim()
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatFieldValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(" / ") : value;
}

function entityLabel(type: string): string {
  const labels: Record<string, string> = {
    place: "地点",
    shop: "店名",
    dish: "菜名",
    skill: "技能",
    tool: "工具",
    style: "风格",
    home: "家居主题",
    creative: "灵感"
  };
  return labels[type] ?? "实体";
}

function buildInsights(items: SavedItem[]) {
  const total = items.length;
  const completed = items.filter((item) => item.status === "completed").length;
  const active = items.filter((item) => ["today", "in_progress", "completed"].includes(item.status)).length;
  const categoryCounts = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});
  const categoryDistribution = Object.entries(categoryCounts)
    .map(([category, count]) => ({
      category,
      count,
      percent: total ? Math.round((count / total) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    completed,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    actionRate: total ? Math.round((active / total) * 100) : 0,
    topCategory: categoryDistribution[0]?.category ?? "",
    categoryDistribution
  };
}





















