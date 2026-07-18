import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { extensionItemsToImportItems, parseShareInput, processImportBatchAsync, type ImportInputItem, type ProcessImportBatchResult } from "@revival/import-service";
import {
  createActionCardRecord,
  createSavedItemRecord,
  createInitialDemoData,
  createSearchLog,
  STORAGE_KEY,
  migrateScannedTextV2,
  migrateScannedTextV3,
  updateItemStatus,
  type ScannedTextMigrationV3Report
} from "@revival/database";
import { getDailyRevivalRecommendations } from "@revival/recommendation-service";
import { searchSavedItems } from "@revival/search-service";
import { AchievementModal, type AchievementDisplay } from "./components/AchievementModal";
import { RewardConfetti } from "./components/RewardConfetti";
import { ThemePicker } from "./components/ThemePicker";
import { TodayWidgetPreview } from "./components/TodayWidgetPreview";
import { RealTestView } from "./components/RealTestView";
import {
  MIGRATION_LEAVE_WARNING,
  MigrationDataUpgradeEntry,
  MigrationDataUpgradePage
} from "./features/storage-migration";
import { ThemeProvider } from "./theme/ThemeProvider";
import { getThemePreset, THEME_STORAGE_KEY, type ThemePresetId } from "./theme/themePresets";
import { createBrowserStorageRuntimeBroadcast, StorageWriteGate } from "@revival/storage-runtime";
import type { ActiveStorageRuntime, StorageRuntimeProductSettings, StorageWriteGateState } from "@revival/storage-runtime";
import { RuntimePersistCoordinator, type RuntimePersistStatus } from "./runtime/runtime-persist-coordinator";
import {
  CATEGORIES,
  REVIVE_INTENTS,
  SAVED_INTENTS,
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
  type PlanCard,
  type PlanCardStatus,
  type ClassificationCorrection,
  type RevivalRecommendation,
  type ReviveIntent,
  type SavedIntent,
  type SavedItem,
  type SearchResult,
  type SearchLog,
  type ShareInput,
  type SmartAlbum,
  type Task
} from "@revival/shared-types";

type ViewKey = "welcome" | "dashboard" | "import" | "old-import" | "search" | "pool" | "detail" | "plans" | "albums" | "insights" | "mobile" | "settings" | "real-test" | "qa";
type SettingsSubRoute = "root" | "data-migration";

const EXTENSION_BETA_VERSION = "0.2.2";
const EXTENSION_ZIP_FILE_NAME = `collection-revival-extension-beta-v${EXTENSION_BETA_VERSION}.zip`;
const EXTENSION_PROTOCOL_VERSION = "collection-revival-web-bridge-v1";
const EXTENSION_WEB_SOURCE = "collection-revival-web";
const EXTENSION_SOURCE = "collection-revival-extension";
const SMART_ALBUM_MATCH_THRESHOLDS = {
  high: 82,
  medium: 52
} as const;
type PoolViewMode = "cards" | "table";
type ImportSuccessResult = { item: SavedItem; card?: ActionCard };

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "今日复活", icon: LayoutDashboard },
  { key: "import", label: "导入中心", icon: Import },
  { key: "albums", label: "智能专辑", icon: LayoutGrid },
  { key: "search", label: "搜索找回", icon: Search },
  { key: "pool", label: "收藏池", icon: Archive },
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

type AppContentProps = {
  initialState: AppState;
  initialSettings: StorageRuntimeProductSettings;
  runtime: ActiveStorageRuntime;
};

export function AppContent({ initialState, initialSettings, runtime, writeGate }: AppContentProps) {
  const [state, setState] = useState<AppState>(initialState);
  const [activeView, setActiveView] = useState<ViewKey>(() => getInitialView());
  const [settingsSubRoute, setSettingsSubRoute] = useState<SettingsSubRoute>(() => getInitialSettingsSubRoute());
  const [importInput, setImportInput] = useState<ShareInput>(emptyImport);
  const [lastImportResult, setLastImportResult] = useState<ImportSuccessResult | null>(null);
  const [importSessionCount, setImportSessionCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(state.savedItems[0]?.id);
  const initialSearchQuery = getInitialSearchQuery();
  const [globalQuery, setGlobalQuery] = useState(initialSearchQuery);
  const [submittedSearch, setSubmittedSearch] = useState(initialSearchQuery);
  const [dashboardQuery, setDashboardQuery] = useState("");
  const [dashboardSubmittedQuery, setDashboardSubmittedQuery] = useState("");
  const [poolQuery, setPoolQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ItemStatus | "all">("all");
  const [poolViewMode, setPoolViewMode] = useState<PoolViewMode>("cards");
  const [toast, setToast] = useState("");
  const [lastCorrectionUndoState, setLastCorrectionUndoState] = useState<AppState | null>(null);
  const [recommendationLimit, setRecommendationLimit] = useState(3);
  const [mobileTab, setMobileTab] = useState<"today" | "search" | "import" | "pool" | "plans" | "settings">("today");
  const [mobileQuery, setMobileQuery] = useState("");
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | undefined>(() => getInitialAlbumId());
  const [developerMode, setDeveloperMode] = useState(() => detectDeveloperMode());
  const [albumFilter, setAlbumFilter] = useState<"candidate" | "confirmed" | "suggested" | "archived">("candidate");
  const [lastPlanUndoState, setLastPlanUndoState] = useState<AppState | null>(null);
  const [lastMigrationUndoState, setLastMigrationUndoState] = useState<AppState | null>(null);
  const [textMigrationPreview, setTextMigrationPreview] = useState<ScannedTextMigrationV3Report | null>(null);
  const [themeId, setThemeId] = useState<ThemePresetId>(() => getThemePreset(initialSettings.themeId).id);
  const [unlockedAchievements, setUnlockedAchievements] = useState<UnlockedAchievementMap>(() => ({ ...initialSettings.achievements }));
  const [runtimePersistStatus, setRuntimePersistStatus] = useState<RuntimePersistStatus>({ status: "idle" });
  const persistCoordinator = useMemo(
    () => new RuntimePersistCoordinator(runtime, setRuntimePersistStatus),
    [runtime]
  );
  const [writeGateState, setWriteGateState] = useState<StorageWriteGateState>(writeGate.state);
  const previousStateRef = useRef(initialState);
  const previousSettingsRef = useRef<StorageRuntimeProductSettings>({
    themeId: getThemePreset(initialSettings.themeId).id,
    achievements: { ...initialSettings.achievements }
  });
  const [achievementModal, setAchievementModal] = useState<AchievementDisplay | null>(null);
  const [rewardBurstId, setRewardBurstId] = useState(0);
  const migrationExecutionActiveRef = useRef(false);
  const setMigrationExecutionActive = useCallback((active: boolean) => {
    migrationExecutionActiveRef.current = active;
  }, []);
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
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => developerMode || (item.key !== "qa" && item.key !== "real-test")),
    [developerMode]
  );
  const todaysPlanCards = useMemo(
    () => (state.planCards ?? []).filter((planCard) => isSameDate(planCard.plannedDate, new Date()) && planCard.status !== "cancelled"),
    [state.planCards]
  );

  useEffect(() => {
    const previous = previousStateRef.current;
    if (previous === state) return;
    previousStateRef.current = state;
    void persistCoordinator.enqueueAppState(previous, state).catch(() => undefined);
  }, [persistCoordinator, state]);

  useEffect(() => {
    const previous = previousSettingsRef.current;
    const next: StorageRuntimeProductSettings = {
      themeId,
      achievements: { ...unlockedAchievements }
    };
    if (previous.themeId === next.themeId && JSON.stringify(previous.achievements) === JSON.stringify(next.achievements)) return;
    previousSettingsRef.current = next;
    void persistCoordinator.enqueueProductSettings(previous, next).catch(() => undefined);
  }, [persistCoordinator, themeId, unlockedAchievements]);

  useEffect(() => {
    const unsubscribeGate = writeGate.subscribe(setWriteGateState);
    const broadcast = createBrowserStorageRuntimeBroadcast();
    const unsubscribeBroadcast = broadcast.subscribe((message) => {
      if (message.type === "activation_preflight_started") {
        void persistCoordinator.freezeForActivationPreflight().catch(() => undefined);
      } else if (message.type === "activation_prepared") {
        writeGate.markPrepared();
      } else {
        writeGate.reopen();
      }
    });
    return () => {
      unsubscribeBroadcast();
      unsubscribeGate();
      broadcast.close();
    };
  }, [persistCoordinator, writeGate]);
  useEffect(() => {
    persistCoordinator.activate();
    return () => {
      persistCoordinator.dispose();
      void persistCoordinator.flush();
    };
  }, [persistCoordinator]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    const syncViewFromLocation = () => {
      if (migrationExecutionActiveRef.current && !window.confirm(MIGRATION_LEAVE_WARNING)) {
        window.history.pushState(null, "", "/settings/data-migration");
        setActiveView("settings");
        setSettingsSubRoute("data-migration");
        return;
      }
      const nextView = getInitialView();
      setActiveView(nextView);
      setSettingsSubRoute(getInitialSettingsSubRoute());
      if (nextView === "search") {
        const query = getInitialSearchQuery();
        setSubmittedSearch(query);
        setGlobalQuery(query);
      }
      if (nextView === "albums") {
        setSelectedAlbumId(getInitialAlbumId());
      }
    };
    window.addEventListener("popstate", syncViewFromLocation);
    return () => window.removeEventListener("popstate", syncViewFromLocation);
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
    () => searchSavedItems(submittedSearch, state.savedItems, state.actionCards, smartAlbums),
    [state.actionCards, state.savedItems, smartAlbums, submittedSearch]
  );

  const dashboardSearchResults = useMemo(
    () => searchSavedItems(dashboardSubmittedQuery, state.savedItems, state.actionCards, smartAlbums).slice(0, 5),
    [dashboardSubmittedQuery, state.actionCards, state.savedItems, smartAlbums]
  );

  const mobileResults = useMemo(
    () => searchSavedItems(mobileQuery, state.savedItems, state.actionCards, smartAlbums).slice(0, 4),
    [mobileQuery, state.actionCards, state.savedItems, smartAlbums]
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
      const ids = new Set(searchSavedItems(poolQuery, items, state.actionCards, smartAlbums).map((result) => result.item.id));
      items = items.filter((item) => ids.has(item.id));
    }

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [categoryFilter, poolQuery, smartAlbums, state.actionCards, state.savedItems, statusFilter]);

  const insights = useMemo(() => buildInsights(state.savedItems), [state.savedItems]);
  const revivalStats = useMemo(() => buildRevivalStats(state.savedItems), [state.savedItems]);
  const unlockedAchievementDisplays = useMemo(
    () =>
      ACHIEVEMENTS.filter((achievement) => unlockedAchievements[achievement.id as AchievementId])
        .map((achievement) => ({ ...achievement, unlockedAt: unlockedAchievements[achievement.id as AchievementId] }))
        .sort((a, b) => new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime()),
    [unlockedAchievements]
  );

  function runSearch(query: string, options: { syncUrl?: boolean } = { syncUrl: true }) {
    const clean = query.trim();
    if (!clean) return;
    const results = searchSavedItems(clean, state.savedItems, state.actionCards, smartAlbums);
    setSubmittedSearch(clean);
    setGlobalQuery(clean);
    setSettingsSubRoute("root");
    setActiveView("search");
    if (options.syncUrl !== false && typeof window !== "undefined") {
      window.history.pushState(null, "", `/search?q=${encodeURIComponent(clean)}`);
    }
    setState((current) => ({
      ...current,
      searchLogs: [...current.searchLogs, createSearchLog(current.user.id, clean, results.length)]
    }));
  }

  function navigatePrimaryView(view: ViewKey) {
    if (
      settingsSubRoute === "data-migration"
      && migrationExecutionActiveRef.current
      && !window.confirm(MIGRATION_LEAVE_WARNING)
    ) {
      return;
    }
    if (settingsSubRoute === "data-migration" && typeof window !== "undefined") {
      const path = view === "welcome" ? "/" : `/${view}`;
      window.history.pushState(null, "", path);
    }
    setSettingsSubRoute("root");
    setActiveView(view);
  }

  function openDataMigration() {
    if (typeof window !== "undefined") window.history.pushState(null, "", "/settings/data-migration");
    setSettingsSubRoute("data-migration");
    setActiveView("settings");
  }

  function returnToSettings() {
    if (typeof window !== "undefined") window.history.pushState(null, "", "/settings");
    setSettingsSubRoute("root");
    setActiveView("settings");
  }

  function returnToImportFromMigration() {
    if (typeof window !== "undefined") window.history.pushState(null, "", "/import");
    setSettingsSubRoute("root");
    setActiveView("import");
  }

  function runDashboardSearch(query: string) {
    const clean = query.trim();
    if (!clean) {
      setDashboardSubmittedQuery("");
      return;
    }
    setDashboardSubmittedQuery(clean);
  }

  function viewAllSearchResults(query: string) {
    runSearch(query);
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
            setLastImportResult({ item: firstItem, card: firstCard });
            setImportSessionCount((count) => count + result.batch.importedCount);
            setActiveView("import");
            window.setTimeout(() => document.getElementById("import-result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
          } else {
            setLastImportResult(null);
          }
          setImportInput(emptyImport);
          setToast(result.batch.importedCount > 0 ? "已整理一条收藏，想行动时再复活它" : result.batch.errorMessage || "这条收藏已经在收藏池里了");
        })
        .catch(() => {
          setToast("导入时遇到问题，表单内容已保留。建议补充标题或备注后再试。");
        })
        .finally(() => setIsImporting(false));
    }, 420);
  }

  async function importExtensionPayload(payload: ExtensionImportPayload) {
    const scannedItems = normalizeExtensionItems(payload.items);
    const scanDuplicateCount = Math.max(0, payload.items.filter((item) => item.sourceUrl || item.title || item.visibleText).length - scannedItems.length);
    if (scannedItems.length === 0) {
      setToast("没有发现可导入的收藏卡片");
      return;
    }

    try {
      const result = annotateScanDuplicateStats(
        await runImportPipeline("extension_scan", "旧收藏扫描 Beta", extensionItemsToImportItems(scannedItems)),
        payload.items.length,
        scanDuplicateCount
      );
      commitImportResult(result);
      setSelectedItemId(result.importedSavedItems[0]?.id);
      setActiveView("old-import");
      setToast(
        result.batch.importedCount > 0
          ? `旧收藏扫描完成：导入 ${result.batch.importedCount} 条，重复 ${result.batch.duplicateCount} 条，生成 ${result.batch.createdAlbumCount} 个专辑候选`
          : "这些扫描结果已经在收藏池里了"
      );
    } catch (error) {
      setToast("旧收藏导入时遇到问题，已保留当前数据。请检查扫描结果后再试。");
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
      const matchedAlbums = applyConfirmedAlbumMatching(
        mergeSmartAlbums(current.smartAlbums ?? smartAlbums, result.smartAlbumCandidates),
        result.importedSavedItems
      );
      return {
        ...current,
        savedItems,
        actionCards: [...result.actionCards, ...current.actionCards],
        smartAlbums: matchedAlbums,
        importBatches: [result.batch, ...(current.importBatches ?? [])],
        importBatchItems: [...result.batchItems, ...(current.importBatchItems ?? [])]
      };
    });
  }
  function continueImport() {
    setImportInput(emptyImport);
    setActiveView("import");
    window.setTimeout(() => {
      document.getElementById("single-import-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector<HTMLInputElement>("[data-testid=\"import-source-url\"]")?.focus();
    }, 0);
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

  async function reviveSavedItem(itemId: string, reviveIntent?: ReviveIntent) {
    const item = state.savedItems.find((entry) => entry.id === itemId);
    if (!item) {
      setToast("没有找到这条收藏");
      return;
    }

    const existingCard = state.actionCards.find((entry) => entry.savedItemId === itemId);
    const intentText = reviveIntent ? `\n你准备拿它做什么：${reviveIntent}` : "";
    setToast(existingCard ? "正在重新生成行动卡..." : "正在为这条收藏生成行动卡...");
    const draft = await aiClient.regenerateActionCard(itemId, {
      savedItem: item,
      userNote: `${item.userNote}${intentText}`.trim()
    });
    const now = new Date().toISOString();

    setState((current) => {
      const currentItem = current.savedItems.find((entry) => entry.id === itemId) ?? item;
      const card = current.actionCards.find((entry) => entry.savedItemId === itemId);
      const newCard = createActionCardRecord(currentItem, draft, new Date());
      const actionCards = card
        ? current.actionCards.map((entry) =>
            entry.id === card.id
              ? {
                  ...entry,
                  category: currentItem.contentDomain,
                  subCategory: currentItem.contentSubDomain,
                  title: draft.title,
                  goal: draft.goal,
                  whySaved: draft.whySaved,
                  nextAction: draft.nextAction,
                  openOriginalFocus: draft.openOriginalFocus,
                  output: draft.output,
                  estimatedTime: draft.estimatedTime,
                  difficulty: draft.difficulty,
                  doneCriteria: draft.doneCriteria,
                  avoidDoing: draft.avoidDoing,
                  ifInfoMissing: draft.ifInfoMissing,
                  followUp: draft.followUp,
                  fields: draft.structuredFields,
                  tasks: cloneTasksForCard(entry.id, draft.tasks),
                  updatedAt: now
                }
              : entry
          )
        : [newCard, ...current.actionCards];

      return {
        ...current,
        savedItems: current.savedItems.map((entry) =>
          entry.id === itemId
            ? { ...entry, savedIntent: mapReviveIntentToSavedIntent(reviveIntent, entry.savedIntent), intent: mapReviveIntentToSavedIntent(reviveIntent, entry.savedIntent), updatedAt: now }
            : entry
        ),
        actionCards
      };
    });
    setSelectedItemId(itemId);
    setActiveView("detail");
    setToast(aiClient.getStatus().fallbackActive ? "已用本地规则生成行动卡" : "已生成行动卡");
  }

  async function regenerateActionCard(itemId: string) {
    await reviveSavedItem(itemId);
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

  function clearLocalTestData() {
    if (!window.confirm("这只会清空当前浏览器里的测试数据，不影响线上项目代码。确定清空吗？")) return;
    setState({
      schemaVersion: state.schemaVersion,
      user: state.user,
      savedItems: [],
      actionCards: [],
      planCards: [],
      classificationCorrections: [],
      searchLogs: [],
      smartAlbums: [],
      importBatches: [],
      importBatchItems: []
    });
    setSelectedItemId(undefined);
    setLastImportResult(null);
    setSubmittedSearch("");
    setGlobalQuery("");
    setPoolQuery("");
    setUnlockedAchievements({});
    setAchievementModal(null);
    setToast("已清空当前浏览器里的本地测试数据");
  }

  function exportLocalData() {
    const content = JSON.stringify(state, null, 2);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `collection-revival-local-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("本地数据已导出为 JSON");
  }

  async function reprocessLocalData() {
    if (state.savedItems.length === 0) {
      setToast("当前没有需要重新整理的本地收藏");
      return;
    }
    setToast("正在用当前规则重新整理旧收藏...");
    try {
      const migration = migrateScannedTextV2(state);
      const now = new Date().toISOString();
      const savedItems = await Promise.all(migration.state.savedItems.map(async (item) => {
        const input = parseShareInput({ sourceUrl: item.sourceUrl, title: item.title, rawShareText: item.rawShareText, userNote: item.userNote });
        const classification = await Promise.resolve(aiClient.classifyAndGenerateActionCard(input));
        const savedItem = createSavedItemRecord(state.user.id, input, classification, new Date(item.createdAt || now));
        return {
          ...savedItem,
          id: item.id,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: now,
          rawTitle: item.rawTitle || item.title,
          cleanedTitle: savedItem.title
        };
      }));
      const savedItemById = new Map(savedItems.map((item) => [item.id, item]));
      const actionCards = state.actionCards.map((card) => {
        const item = savedItemById.get(card.savedItemId);
        return item ? { ...card, category: item.contentDomain, subCategory: item.contentSubDomain, updatedAt: now } : card;
      });
      setState((current) => ({
        ...current,
        savedItems,
        actionCards,
        smartAlbums: mergeGeneratedSmartAlbums([], savedItems)
      }));
      setSelectedItemId(savedItems[0]?.id);
      setLastImportResult(null);
      setToast(`已重新整理 ${savedItems.length} 条本地收藏，修复标题 ${migration.repairedTitleCount} 条`);
    } catch {
      setToast("重新整理时遇到问题，当前数据已保留。可以先导出数据或清空本地测试数据。");
    }
  }

  function previewTextMigration() {
    const report = migrateScannedTextV3(state);
    setTextMigrationPreview(report);
    setToast(`已检查 ${report.checkedCount} 条记录，发现 ${report.abnormalCount} 条可能需要修复`);
  }

  function applyTextMigration() {
    if (!textMigrationPreview) {
      setToast("请先生成旧扫描文本修复预览");
      return;
    }
    setLastMigrationUndoState(state);
    setState(textMigrationPreview.state);
    setTextMigrationPreview(null);
    setToast("已应用旧扫描文本修复，可在本次会话撤销");
  }

  function cancelTextMigration() {
    setTextMigrationPreview(null);
    setToast("已取消旧扫描文本修复");
  }

  function undoTextMigration() {
    if (!lastMigrationUndoState) {
      setToast("暂无可撤销的文本修复");
      return;
    }
    setState(lastMigrationUndoState);
    setLastMigrationUndoState(null);
    setToast("已撤销上次旧扫描文本修复");
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

  function confirmSmartAlbum(albumId: string, options: { autoCollectEnabled?: boolean; mediumMatchRequiresApproval?: boolean } = {}) {
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((entry) =>
        entry.id === albumId
          ? {
              ...entry,
              status: "confirmed",
              confirmedAt: entry.confirmedAt ?? now,
              archivedAt: undefined,
              autoCollectEnabled: options.autoCollectEnabled ?? true,
              mediumMatchRequiresApproval: options.mediumMatchRequiresApproval ?? true,
              matchProfile: buildAlbumMatchProfile(entry, current.savedItems),
              schemaVersion: 2,
              updatedAt: now
            }
          : entry
      )
    }));
    setToast("高度匹配的新收藏会自动进入，中等匹配会先等待确认。");
  }

  function archiveSmartAlbum(albumId: string) {
    const album = smartAlbums.find((entry) => entry.id === albumId);
    if (album && !window.confirm("归档后会从待确认列表隐藏，但不会删除收藏，可以随时恢复。")) return;
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((entry) =>
        entry.id === albumId ? { ...entry, status: "archived", archivedAt: now, updatedAt: now } : entry
      )
    }));
    setToast("已归档这个专辑候选，收藏本身不会被删除");
  }

  function restoreSmartAlbum(albumId: string) {
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((entry) =>
        entry.id === albumId ? { ...entry, status: "candidate", archivedAt: undefined, updatedAt: now } : entry
      )
    }));
    setToast("已恢复为候选专辑");
  }

  function acceptSuggestedAlbumItem(albumId: string, itemId: string) {
    updateAlbumMembership(albumId, [itemId], "accept_suggested");
  }

  function rejectSuggestedAlbumItem(albumId: string, itemId: string) {
    updateAlbumMembership(albumId, [itemId], "reject_suggested");
  }

  function acceptAllSuggestedAlbumItems(albumId: string) {
    const album = smartAlbums.find((entry) => entry.id === albumId);
    if (!album || !album.suggestedItemIds?.length) return;
    updateAlbumMembership(albumId, album.suggestedItemIds, "accept_suggested");
  }

  function updateAlbumMembership(albumId: string, itemIds: string[], action: "accept_suggested" | "reject_suggested" | "remove") {
    const previousSnapshot = state;
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      smartAlbums: (current.smartAlbums ?? smartAlbums).map((album) => {
        if (album.id !== albumId) return album;
        const itemSet = new Set(album.savedItemIds);
        const suggestedSet = new Set(album.suggestedItemIds ?? []);
        const manuallyAdded = new Set(album.manuallyAddedItemIds ?? []);
        const manuallyRemoved = new Set(album.manuallyRemovedItemIds ?? []);
        itemIds.forEach((id) => {
          if (action === "accept_suggested") {
            itemSet.add(id);
            suggestedSet.delete(id);
            manuallyAdded.add(id);
            manuallyRemoved.delete(id);
          } else {
            itemSet.delete(id);
            suggestedSet.delete(id);
            manuallyRemoved.add(id);
            manuallyAdded.delete(id);
          }
        });
        return {
          ...album,
          savedItemIds: [...itemSet],
          recommendedItemIds: album.recommendedItemIds.filter((id) => itemSet.has(id)).slice(0, 3),
          suggestedItemIds: [...suggestedSet],
          manuallyAddedItemIds: [...manuallyAdded],
          manuallyRemovedItemIds: [...manuallyRemoved],
          updatedAt: now
        };
      })
    }));
    setLastCorrectionUndoState(previousSnapshot);
    setToast(action === "accept_suggested" ? "已加入专辑" : "已从专辑移除，后续不会自动塞回");
  }

  function correctSavedItemClassification(itemId: string, mode: "domain" | "intent") {
    const currentItem = state.savedItems.find((item) => item.id === itemId);
    if (!currentItem) return;

    let patch: Partial<SavedItem> | undefined;
    let correctedDomain = currentItem.contentDomain;
    let correctedSubDomain = currentItem.contentSubDomain;
    let correctedIntent = currentItem.savedIntent;
    if (mode === "domain") {
      const domainInput = window.prompt(`修改内容主题（可选：${CATEGORIES.join(" / ")}）`, currentItem.contentDomain)?.trim();
      if (!domainInput) return;
      const safeDomain = (CATEGORIES as readonly string[]).includes(domainInput) ? domainInput as Category : "暂存";
      const subDomainInput = window.prompt("修改二级主题，例如 AI工具 / 展览活动 / 封面设计", currentItem.contentSubDomain)?.trim();
      correctedDomain = safeDomain;
      correctedSubDomain = subDomainInput || (safeDomain === "暂存" ? "待补充备注" : currentItem.contentSubDomain);
      patch = {
        contentDomain: safeDomain,
        category: safeDomain,
        contentSubDomain: correctedSubDomain,
        subCategory: correctedSubDomain,
        confidence: "medium",
        classificationConfidence: "medium",
        whyThisDomain: "用户在智能专辑中手动纠正过内容主题。",
        whyThisCategory: "用户在智能专辑中手动纠正过内容主题。"
      };
    } else {
      const intentInput = window.prompt(`修改收藏用途（可选：${SAVED_INTENTS.join(" / ")}）`, currentItem.savedIntent)?.trim();
      if (!intentInput) return;
      const safeIntent = (SAVED_INTENTS as readonly string[]).includes(intentInput) ? intentInput as SavedIntent : "暂时保存";
      correctedIntent = safeIntent;
      patch = {
        savedIntent: safeIntent,
        intent: safeIntent,
        whyThisIntent: "用户在智能专辑中手动纠正过收藏用途。"
      };
    }

    const now = new Date().toISOString();
    const correction: ClassificationCorrection = {
      id: createLocalId("correction"),
      savedItemId: itemId,
      previousDomain: currentItem.contentDomain,
      previousSubDomain: currentItem.contentSubDomain,
      previousIntent: currentItem.savedIntent,
      correctedDomain,
      correctedSubDomain,
      correctedIntent,
      tags: currentItem.keywords.slice(0, 8),
      textSnapshot: [currentItem.title, currentItem.rawShareText, currentItem.userNote].filter(Boolean).join(" "),
      createdAt: now
    };
    const previousSnapshot = state;
    setState((current) => {
      const savedItems = current.savedItems.map((item) =>
        item.id === itemId ? { ...item, ...patch, searchableText: rebuildItemSearchableText({ ...item, ...patch }), updatedAt: now } : item
      );
      return {
        ...current,
        savedItems,
        classificationCorrections: [correction, ...(current.classificationCorrections ?? [])],
        smartAlbums: mergeGeneratedSmartAlbums(current.smartAlbums ?? smartAlbums, savedItems)
      };
    });
    setLastCorrectionUndoState(previousSnapshot);
    setToast(mode === "domain" ? "已按新的内容主题重新整理专辑，可在专辑详情撤销" : "已按新的收藏用途重新整理专辑，可在专辑详情撤销");
  }

  function undoLastClassificationChange() {
    if (!lastCorrectionUndoState) {
      setToast("暂无可撤销的分类修改");
      return;
    }
    setState(lastCorrectionUndoState);
    setLastCorrectionUndoState(null);
    setToast("已撤销上次分类修改");
  }

  function addActionCardToPlan(cardId: string) {
    const card = state.actionCards.find((entry) => entry.id === cardId);
    const item = state.savedItems.find((entry) => entry.id === card?.savedItemId);
    if (!card || !item) return;
    const dateInput = window.prompt("准备哪天做？可填：今天 / 明天 / 本周 / 2026-07-20", "今天")?.trim() || "今天";
    const estimatedInput = window.prompt("预计用时（分钟）：10 / 20 / 30 / 60", parseEstimatedMinutes(card.estimatedTime).toString())?.trim() || "20";
    const nextAction = window.prompt("下一步行动，可以微调", card.nextAction)?.trim() || card.nextAction;
    const now = new Date();
    const planCard: PlanCard = {
      id: createLocalId("plan_card"),
      savedItemId: item.id,
      actionCardId: card.id,
      title: card.title,
      sourceTitle: formatItemTitle(item),
      plannedDate: parsePlanDate(dateInput, now).toISOString(),
      estimatedMinutes: clampEstimatedMinutes(Number(estimatedInput)),
      oneNextStep: nextAction,
      doneCriteria: card.doneCriteria,
      status: "planned",
      reminderEnabled: false,
      createdAt: now.toISOString()
    };
    setState((current) => ({
      ...current,
      planCards: [planCard, ...(current.planCards ?? [])],
      savedItems: current.savedItems.map((entry) =>
        entry.id === item.id ? { ...entry, status: entry.status === "not_started" ? "today" : entry.status, updatedAt: now.toISOString() } : entry
      )
    }));
    setToast(isSameDate(planCard.plannedDate, new Date()) ? "已加入今天的计划卡" : "已加入轻量计划卡");
  }

  function updatePlanCardStatus(planCardId: string, status: PlanCardStatus) {
    const now = new Date().toISOString();
    const previousSnapshot = state;
    const planCard = state.planCards?.find((entry) => entry.id === planCardId);
    const previousItem = planCard ? state.savedItems.find((item) => item.id === planCard.savedItemId) : undefined;
    setState((current) => ({
      ...current,
      planCards: (current.planCards ?? []).map((planCard) =>
        planCard.id === planCardId
          ? {
              ...planCard,
              status,
              completedAt: status === "done" ? now : planCard.completedAt,
              cancelledAt: status === "cancelled" ? now : planCard.cancelledAt
            }
          : planCard
      ),
      savedItems: status === "done" && planCard
        ? current.savedItems.map((item) =>
            item.id === planCard.savedItemId ? { ...item, status: "completed", updatedAt: now } : item
          )
        : status === "doing" && planCard
          ? current.savedItems.map((item) =>
              item.id === planCard.savedItemId && item.status !== "completed" ? { ...item, status: "in_progress", updatedAt: now } : item
            )
          : current.savedItems
    }));
    setLastPlanUndoState(previousSnapshot);
    if (status === "done") {
      unlockAchievements(["plan_finished"]);
      if (previousItem?.status !== "completed") {
        triggerCompletionReward(updateItemStatus(state.savedItems, planCard?.savedItemId ?? "", "completed"));
      }
    }
  }

  function postponePlanCard(planCardId: string) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    updatePlanCardDate(planCardId, tomorrow, "已延期到明天");
  }

  function reschedulePlanCard(planCardId: string) {
    const current = state.planCards?.find((planCard) => planCard.id === planCardId);
    const value = window.prompt("更换到哪天？可填：今天 / 明天 / 2026-07-20", current ? formatDateInput(current.plannedDate) : "明天")?.trim();
    if (!value) return;
    updatePlanCardDate(planCardId, parsePlanDate(value, new Date()), "已更新计划日期");
  }

  function cancelPlanCard(planCardId: string) {
    updatePlanCardStatus(planCardId, "cancelled");
    setToast("已取消这张计划卡，历史会保留");
  }

  function updatePlanCardDate(planCardId: string, plannedDate: Date, message: string) {
    const previousSnapshot = state;
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      planCards: (current.planCards ?? []).map((planCard) =>
        planCard.id === planCardId ? { ...planCard, plannedDate: plannedDate.toISOString(), status: "planned", updatedAt: now } : planCard
      )
    }));
    setLastPlanUndoState(previousSnapshot);
    setToast(message);
  }

  function viewPlanSource(planCard: PlanCard) {
    setSelectedItemId(planCard.savedItemId);
    setActiveView("detail");
  }

  function undoPlanChange() {
    if (!lastPlanUndoState) {
      setToast("暂无可撤销的计划修改");
      return;
    }
    setState(lastPlanUndoState);
    setLastPlanUndoState(null);
    setToast("已撤销上次计划修改");
  }

  function selectAlbum(albumId: string) {
    setSelectedAlbumId(albumId);
    setActiveView("albums");
    window.history.pushState(null, "", `/albums/${encodeURIComponent(albumId)}`);
  }

  function removeItemFromAlbum(albumId: string, itemId: string) {
    const previousSnapshot = state;
    setState((current) => {
      const nextSmartAlbums: SmartAlbum[] = (current.smartAlbums ?? smartAlbums)
        .map((album: SmartAlbum) =>
          album.id === albumId
            ? {
                ...album,
                savedItemIds: album.savedItemIds.filter((id: string) => id !== itemId),
                recommendedItemIds: album.recommendedItemIds.filter((id: string) => id !== itemId),
                suggestedItemIds: (album.suggestedItemIds ?? []).filter((id: string) => id !== itemId),
                manuallyRemovedItemIds: Array.from(new Set([...(album.manuallyRemovedItemIds ?? []), itemId])),
                updatedAt: new Date().toISOString()
              }
            : album
        )
        .filter((album: SmartAlbum) => album.status === "confirmed" || album.savedItemIds.length > 0);
      return { ...current, smartAlbums: nextSmartAlbums };
    });
    setLastCorrectionUndoState(previousSnapshot);
    setToast("已从当前专辑移除，收藏本身仍在收藏池");
  }

  function moveItemToTheme(itemId: string) {
    correctSavedItemClassification(itemId, "domain");
  }

  function addItemToIntentAlbum(itemId: string) {
    correctSavedItemClassification(itemId, "intent");
  }

  function bulkCorrectAlbumItems(itemIds: string[], mode: "domain" | "intent") {
    if (itemIds.length === 0) {
      setToast("先选择至少一条收藏");
      return;
    }
    const previousSnapshot = state;
    const now = new Date().toISOString();
    let patchFactory: (item: SavedItem) => Partial<SavedItem>;
    if (mode === "domain") {
      const domainInput = window.prompt(`批量移动主题（可选：${CATEGORIES.join(" / ")}）`, "暂存")?.trim();
      if (!domainInput) return;
      const safeDomain = (CATEGORIES as readonly string[]).includes(domainInput) ? domainInput as Category : "暂存";
      const subDomainInput = window.prompt("批量二级主题，例如 AI工具 / 展览活动 / 封面设计", safeDomain === "暂存" ? "待补充备注" : "主题整理")?.trim();
      patchFactory = () => ({
        contentDomain: safeDomain,
        category: safeDomain,
        contentSubDomain: subDomainInput || (safeDomain === "暂存" ? "待补充备注" : "主题整理"),
        subCategory: subDomainInput || (safeDomain === "暂存" ? "待补充备注" : "主题整理"),
        confidence: "medium",
        classificationConfidence: "medium",
        whyThisDomain: "用户在智能专辑中批量移动过内容主题。",
        whyThisCategory: "用户在智能专辑中批量移动过内容主题。"
      });
    } else {
      const intentInput = window.prompt(`批量添加用途专辑（可选：${SAVED_INTENTS.join(" / ")}）`, "以后查阅")?.trim();
      if (!intentInput) return;
      const safeIntent = (SAVED_INTENTS as readonly string[]).includes(intentInput) ? intentInput as SavedIntent : "以后查阅";
      patchFactory = () => ({
        savedIntent: safeIntent,
        intent: safeIntent,
        whyThisIntent: "用户在智能专辑中批量调整过收藏用途。"
      });
    }
    const selectedIds = new Set(itemIds);
    setState((current) => {
      const savedItems = current.savedItems.map((item) => {
        if (!selectedIds.has(item.id)) return item;
        const patch = patchFactory(item);
        const nextItem = { ...item, ...patch, updatedAt: now };
        return { ...nextItem, searchableText: rebuildItemSearchableText(nextItem) };
      });
      return {
        ...current,
        savedItems,
        smartAlbums: mergeGeneratedSmartAlbums(current.smartAlbums ?? smartAlbums, savedItems)
      };
    });
    setLastCorrectionUndoState(previousSnapshot);
    setToast(mode === "domain" ? "已批量移动主题，可撤销" : "已批量添加用途专辑，可撤销");
  }

  function createManualAlbum() {
    const title = window.prompt("新建专辑名称")?.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const album: SmartAlbum = {
      id: createLocalId("album_manual"),
      title,
      description: "用户手动创建的专辑，不会被自动重新整理覆盖。",
      albumView: "content_domain",
      contentDomain: "暂存",
      contentSubDomain: "手动专辑",
      category: "暂存",
      albumType: "manual_album",
      keywords: ["手动专辑"],
      savedItemIds: [],
      recommendedItemIds: [],
      whyThisAlbum: "这是用户手动创建的收藏集合。",
      whyStartHere: "手动添加收藏后再决定从哪一条开始。",
      suggestedFirstAction: "先添加 2 条以上同主题收藏，再挑一条复活。",
      priority: "low",
      priorityScore: 0,
      status: "confirmed",
      createdAt: now,
      updatedAt: now
    };
    setState((current) => ({ ...current, smartAlbums: [album, ...(current.smartAlbums ?? smartAlbums)] }));
    setSelectedAlbumId(album.id);
    setToast("已新建手动专辑");
  }
  if (writeGateState !== "open") {
    return (
      <ThemeProvider themeId={themeId}>
        <main className="app-boot-screen" data-testid={writeGateState === "activation_prepared" ? "app-write-gate-prepared" : "app-write-gate-preflight"}>
          <section className="app-boot-panel warning" role="alert">
            <p className="app-boot-kicker">本地数据保护</p>
            <h1>{writeGateState === "activation_prepared" ? "新存储已经准备，尚未切换" : "正在检查新存储启用条件"}</h1>
            <p>{writeGateState === "activation_prepared" ? "当前正式数据源仍是旧本地存储。普通编辑已冻结，请前往数据管理取消准备或等待下一阶段。" : "正在保存已有修改并核对数据。此页面暂时不能继续编辑，当前数据源仍是旧本地存储。"}</p>
            <button className="primary-button" type="button" onClick={() => window.location.assign("/settings/data-migration")}>前往数据管理</button>
          </section>
        </main>
      </ThemeProvider>
    );
  }
  if (activeView === "welcome") {
    return (
      <ThemeProvider themeId={themeId}>
        <WelcomeHero
          onEnterWorkspace={() => setActiveView("dashboard")}
          onStartImport={() => setActiveView("old-import")}
          onQuickImport={() => setActiveView("import")}
          onToday={() => setActiveView("dashboard")}
        />
        <RewardConfetti burstId={rewardBurstId} />
        <AchievementModal achievement={achievementModal} onClose={() => setAchievementModal(null)} />
        <RuntimeSaveAlert status={runtimePersistStatus} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider themeId={themeId}>
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigatePrimaryView("welcome")}>
          <span className="brand-mark">复</span>
          <span>
            <strong>收藏复活</strong>
            <small>从心动到行动</small>
          </span>
        </button>

        <nav className="nav-list" aria-label="主导航">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={activeView === item.key ? "nav-item active" : "nav-item"} onClick={() => navigatePrimaryView(item.key)}>
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
            <button className="icon-text-button" onClick={() => navigatePrimaryView("import")}>
              <Share2 size={17} />
              导入一条
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
              planCards={todaysPlanCards}
              updatePlanCardStatus={updatePlanCardStatus}
              postponePlanCard={postponePlanCard}
              reschedulePlanCard={reschedulePlanCard}
              cancelPlanCard={cancelPlanCard}
              viewPlanSource={viewPlanSource}
              undoPlanChange={undoPlanChange}
              canUndoPlanChange={Boolean(lastPlanUndoState)}
              dashboardQuery={dashboardQuery}
              setDashboardQuery={setDashboardQuery}
              dashboardSubmittedQuery={dashboardSubmittedQuery}
              dashboardSearchResults={dashboardSearchResults}
              runDashboardSearch={runDashboardSearch}
              viewAllSearchResults={viewAllSearchResults}
              reviveSavedItem={reviveSavedItem}
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
              importSessionCount={importSessionCount}
              aiStatus={aiStatus}
              changeStatus={changeStatus}
              viewActionCard={viewActionCard}
              reviveSavedItem={reviveSavedItem}
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
              addActionCardToPlan={addActionCardToPlan}
              setActiveView={setActiveView}
              onContinueImport={continueImport}
            />
          )}

{activeView === "detail" && selectedItem && !selectedCard && (
            <SavedIndexDetailView
              item={selectedItem}
              openSource={openSource}
              updateSavedNote={updateSavedNote}
              reviveSavedItem={reviveSavedItem}
              setActiveView={setActiveView}
              onContinueImport={continueImport}
            />
          )}

          {activeView === "detail" && !selectedItem && (
            <EmptyState title="还没有可查看的收藏" text="先导入一条收藏，它会进入收藏索引；想行动时再生成行动卡。" />
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
              restoreAlbum={restoreSmartAlbum}
              acceptSuggestedItem={acceptSuggestedAlbumItem}
              rejectSuggestedItem={rejectSuggestedAlbumItem}
              acceptAllSuggestedItems={acceptAllSuggestedAlbumItems}
              regenerateSmartAlbums={regenerateSmartAlbums}
              correctSavedItemClassification={correctSavedItemClassification}
              selectedAlbumId={selectedAlbumId}
              onSelectAlbum={selectAlbum}
              removeItemFromAlbum={removeItemFromAlbum}
              moveItemToTheme={moveItemToTheme}
              addItemToIntentAlbum={addItemToIntentAlbum}
              bulkCorrectAlbumItems={bulkCorrectAlbumItems}
              createManualAlbum={createManualAlbum}
              undoLastClassificationChange={undoLastClassificationChange}
              canUndoClassificationChange={Boolean(lastCorrectionUndoState)}
              albumFilter={albumFilter}
              setAlbumFilter={setAlbumFilter}
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

          {activeView === "settings" && settingsSubRoute === "root" && (
            <SettingsView
              userName={state.user.name}
              recommendationLimit={recommendationLimit}
              setRecommendationLimit={setRecommendationLimit}
              resetDemoData={resetDemoData}
              clearLocalTestData={clearLocalTestData}
              exportLocalData={exportLocalData}
              reprocessLocalData={reprocessLocalData}
              previewTextMigration={previewTextMigration}
              applyTextMigration={applyTextMigration}
              cancelTextMigration={cancelTextMigration}
              undoTextMigration={undoTextMigration}
              textMigrationPreview={textMigrationPreview}
              canUndoTextMigration={Boolean(lastMigrationUndoState)}
              themeId={themeId}
              setThemeId={setThemeId}
              aiStatus={aiStatus}
              syncStatus={syncStatus}
              developerMode={developerMode}
              setDeveloperMode={setDeveloperMode}
              openInternalTool={(view) => setActiveView(view)}
              openDataMigration={openDataMigration}
            />
          )}

          {activeView === "settings" && settingsSubRoute === "data-migration" && (
            <MigrationDataUpgradePage
              onBackToSettings={returnToSettings}
              onReturnToImport={returnToImportFromMigration}
              onExecutionActiveChange={setMigrationExecutionActive}
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
        <RuntimeSaveAlert status={runtimePersistStatus} />
        <RewardConfetti burstId={rewardBurstId} />
        <AchievementModal achievement={achievementModal} onClose={() => setAchievementModal(null)} />
      </main>
    </div>
    </ThemeProvider>
  );
}

function RuntimeSaveAlert({ status }: { status: RuntimePersistStatus }) {
  if (status.status !== "failed") return null;
  return (
    <div className="runtime-save-alert" role="alert" data-testid="runtime-save-error">
      <strong>这次修改还没有保存</strong>
      <span>请保留当前页面并重试操作。本地数据没有被清空。</span>
      <code>{status.code}</code>
    </div>
  );
}

function WelcomeHero(props: { onEnterWorkspace: () => void; onStartImport: () => void; onQuickImport: () => void; onToday: () => void }) {
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
          <button className="welcome-outline-button" onClick={props.onQuickImport}>导入一条新收藏</button>
        </div>
      </nav>

      <section className="welcome-hero">
        <div className="welcome-copy reveal-up">
          <span className="welcome-kicker"><Sparkles size={16} /> AI 收藏行动助手</span>
          <h1>别让收藏夹替你努力</h1>
          <p>先把吃灰的旧收藏整理成主题和用途；真正想行动时，再生成一张小行动卡。</p>
          <div className="welcome-cta-row">
            <button className="welcome-primary-button" onClick={props.onStartImport}>
              <Share2 size={18} />
              扫描我的旧收藏
            </button>
            <button className="welcome-secondary-button" onClick={props.onToday}>
              <Play size={17} />
              看看今日行动
            </button>
          </div>
          <div className="welcome-proof-row" aria-label="产品能力">
            <span>自动分类</span>
            <span>用途识别</span>
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
                  <span>用途识别</span>
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
  planCards: PlanCard[];
  updatePlanCardStatus: (planCardId: string, status: PlanCardStatus) => void;
  postponePlanCard: (planCardId: string) => void;
  reschedulePlanCard: (planCardId: string) => void;
  cancelPlanCard: (planCardId: string) => void;
  viewPlanSource: (planCard: PlanCard) => void;
  undoPlanChange: () => void;
  canUndoPlanChange: boolean;
  dashboardQuery: string;
  setDashboardQuery: (value: string) => void;
  dashboardSubmittedQuery: string;
  dashboardSearchResults: SearchResult[];
  runDashboardSearch: (query: string) => void;
  viewAllSearchResults: (query: string) => void;
  reviveSavedItem: (itemId: string) => void;
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
  function handleDashboardSearch(event: FormEvent) {
    event.preventDefault();
    props.runDashboardSearch(props.dashboardQuery);
  }

  return (
    <div className="dashboard-redesign">
      <section className="dashboard-hero-v3 reveal-up">
        <div className="dashboard-hero-copy-v3">
          <span className="welcome-kicker"><Sparkles size={16} /> 今日复活</span>
          <h1>先把旧收藏捡回来</h1>
          <p>扫描旧收藏，整理成主题和用途；等你决定复活哪一条，再生成行动卡。</p>
          <form className="dashboard-search-prompt dashboard-search-form" aria-label="今日复活搜索" onSubmit={handleDashboardSearch}>
            <Search size={18} />
            <label>
              <strong>找一条收藏，今天复活</strong>
              <span>搜一个地点、技能、菜名、工具或主题，只做最小的一步。</span>
              <input
                value={props.dashboardQuery}
                onChange={(event) => props.setDashboardQuery(event.target.value)}
                placeholder="比如 AI、深圳、低卡晚餐、封面设计"
                data-testid="dashboard-search-input"
              />
            </label>
            <kbd>Ctrl K</kbd>
            <button type="submit" data-testid="dashboard-search-submit">搜索</button>
          </form>
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
            ) : null}
          </div>
          {props.planCards.length === 0 && (
            <EmptyState title="今天还没有安排" text="搜一条收藏，做最小的一步。" />
          )}
          {props.planCards.length > 0 && (
            <div className="plan-card-stack" data-testid="today-plan-cards">
              <div className="section-heading-soft">
                <span><CalendarCheck size={18} /> 今天的计划卡</span>
                <small>{props.planCards.length} 张主动加入</small>
              </div>
              {props.planCards.map((planCard) => (
                <article className="plan-mini-row" key={planCard.id}>
                  <div>
                    <strong>{planCard.title}</strong>
                    <span>来源：{planCard.sourceTitle || "来源收藏待补充"}</span>
                    <span>{planCard.estimatedMinutes} 分钟 · {planCard.oneNextStep}</span>
                    <small>{formatDate(planCard.plannedDate)} · 完成标准：{planCard.doneCriteria} · {planCard.status === "doing" ? "进行中" : planCard.status === "done" ? "已完成" : "计划中"}</small>
                  </div>
                  <div className="plan-card-actions">
                    <button onClick={() => props.updatePlanCardStatus(planCard.id, "doing")}>开始</button>
                    <button onClick={() => props.updatePlanCardStatus(planCard.id, "done")}>完成</button>
                    <button onClick={() => props.postponePlanCard(planCard.id)}>延期到明天</button>
                    <button onClick={() => props.reschedulePlanCard(planCard.id)}>更换日期</button>
                    <button onClick={() => props.cancelPlanCard(planCard.id)}>取消计划</button>
                    <button onClick={() => props.viewPlanSource(planCard)}>查看来源收藏</button>
                  </div>
                </article>
              ))}
              <button className="ghost-action" onClick={props.undoPlanChange} disabled={!props.canUndoPlanChange}>撤销上次计划修改</button>
            </div>
          )}
          <DashboardSearchResults
            query={props.dashboardSubmittedQuery}
            results={props.dashboardSearchResults}
            openSource={props.openSource}
            viewActionCard={props.viewActionCard}
            reviveSavedItem={props.reviveSavedItem}
            viewAllSearchResults={props.viewAllSearchResults}
          />
        </section>

        <section className="quick-revive-board reveal-up delay-2">
          <div className="section-heading-soft">
            <span><Share2 size={18} /> 导入一条新收藏</span>
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
                    <small>{item.contentDomain} / {item.contentSubDomain} · 用途：{item.savedIntent} · {DISPLAY_STATUS_LABELS[item.status]}</small>
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
  importSessionCount: number;
  aiStatus: AiRuntimeStatus;
  changeStatus: (itemId: string, status: ItemStatus) => void;
  viewActionCard: (itemId: string) => void;
  reviveSavedItem: (itemId: string, reviveIntent?: ReviveIntent) => void;
  onContinueImport: () => void;
}) {
  const usingMock = props.aiStatus.mode === "mock" || props.aiStatus.fallbackActive;
  const methods: Array<{ title: string; description: string; action: string; secondaryAction?: string; status: string; primary: boolean; onClick?: () => void; onSecondaryClick?: () => void }> = [
    {
      title: "旧收藏扫描 Beta",
      description: "产品主路径：扫描你本人小红书网页版已加载的旧收藏，先整理成主题和用途。当前需要安装桌面浏览器扩展 Beta。",
      action: "进入旧收藏扫描控制台",
      secondaryAction: "下载/查看扩展安装说明",
      status: "主入口 · Beta",
      primary: true,
      onClick: () => props.setActiveView("old-import"),
      onSecondaryClick: () => props.setActiveView("old-import")
    },
    {
      title: "新收藏导入",
      description: "手动粘贴适合补充测试，也适合新看到的一条收藏。导入后先进入索引，不会立刻变成任务。",
      action: "导入一条新收藏",
      status: "补充入口",
      primary: false,
      onClick: () => document.getElementById("single-import-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })
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
      description: "后续支持 Chrome / Edge 书签导入，把网页收藏整理成行动索引。",
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
    }  ];

  return (
    <>
      <div className="page-title-row airy-title">
        <div>
          <p className="eyebrow">导入中心</p>
          <h1>先扫描旧收藏，再补充导入新收藏</h1>
        </div>
        <p className="page-lead">旧收藏扫描是主路径；如果你还没安装扩展，可以先用手动导入补充测试。导入后先生成收藏索引和智能专辑，想行动时再复活单条。</p>
      </div>

      {props.lastImportResult && (
        <section id="import-result-panel" className="tool-panel single import-success-panel" data-testid="import-success-panel">
          <div className="section-heading-soft">
            <span><CheckCircle2 size={18} /> 整理完成</span>
            <small>本次已导入 {props.importSessionCount} 条</small>
          </div>
          <div className="import-success-body">
            <div className="row-meta">
              <span>{props.lastImportResult.item.contentDomain}</span>
              <span>{props.lastImportResult.item.contentSubDomain}</span>
              <span>用途：{props.lastImportResult.item.savedIntent}</span>
              <span>信心：{confidenceLabel(props.lastImportResult.item.confidence)}</span>
            </div>
            <strong>{formatItemTitle(props.lastImportResult.item)}</strong>
            <p>{formatItemSummary(props.lastImportResult.item)}</p>
            <div className="field-grid compact-fields">
              <div className="field-card"><span>内容主题</span><strong>{props.lastImportResult.item.contentDomain} / {props.lastImportResult.item.contentSubDomain}</strong></div>
              <div className="field-card"><span>收藏用途</span><strong>{props.lastImportResult.item.savedIntent}</strong></div>
              <div className="field-card"><span>为什么这样分</span><strong>{props.lastImportResult.item.whyThisDomain}</strong></div>
              <div className="field-card"><span>为什么这样用</span><strong>{props.lastImportResult.item.whyThisIntent}</strong></div>
            </div>
            <div className="tag-list">
              {props.lastImportResult.item.keywords.slice(0, 6).map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
            {props.lastImportResult.item.confidence === "low" && (
              <p className="quiet-copy">这条收藏信息较少，分类可能不准。可以补充一句“我为什么收藏它”，再选择复活用途生成行动卡。</p>
            )}
            {props.importSessionCount >= 3 && <p className="quiet-copy">你已经连续导入了 {props.importSessionCount} 条，可以去智能专辑看看系统整理出的主题。</p>}
            {usingMock && <p className="quiet-copy">当前使用：本地规则 / Mock AI。生成质量可能有限，配置真实 AI 后分类和行动卡会更具体。</p>}
          </div>
          <div className="card-actions">
            <button className="primary-button" onClick={() => props.reviveSavedItem(props.lastImportResult!.item.id)} data-testid="revive-imported-item">复活这条</button>
            <button className="secondary-action" onClick={props.onContinueImport} data-testid="continue-import">继续导入一条</button>
            <button className="secondary-action" onClick={() => props.viewActionCard(props.lastImportResult!.item.id)}>查看收藏索引</button>
            <button className="secondary-action" onClick={() => props.setActiveView("albums")}>查看智能专辑</button>
            <button className="ghost-action" onClick={() => props.setActiveView("search")}>搜索找回试试</button>
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
          <span><Share2 size={18} /> 导入一条新收藏</span>
          <small>第一次测试，先从这里开始</small>
        </div>
        {usingMock && <p className="quiet-copy">当前使用：本地规则 / Mock AI。它能跑通流程，但真实 AI 会让分类和行动卡更贴近原帖主题。</p>}
        <QuickImportForm input={props.importInput} setInput={props.setImportInput} onSubmit={props.handleImport} isLoading={props.isImporting} />
        <ImportSamplePreview onUseSample={props.setImportInput} />
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
              <span>已复活 {batch.createdActionCardCount}</span>
              <span>专辑 {batch.createdAlbumCount}</span>
              <button onClick={() => props.setActiveView(batch.source === "extension_scan" ? "old-import" : "albums")}>查看详情</button>
            </article>
          ))}
          {props.importBatches.length === 0 && <EmptyState title="还没有导入记录" text="先导入一条真实收藏；旧收藏扫描需要本地浏览器扩展 Beta，普通朋友测试可以先跳过。" />}
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
  type ExtensionFailureReason =
    | "PAGE_REFRESH_REQUIRED"
    | "EXTENSION_NOT_DETECTED"
    | "CONTENT_SCRIPT_NOT_INJECTED"
    | "EXTENSION_VERSION_TOO_OLD"
    | "PROTOCOL_VERSION_MISMATCH"
    | "HANDSHAKE_TIMEOUT"
    | "UNSUPPORTED_BROWSER"
    | "EXTENSION_DISABLED";
  type ExtensionStatus = {
    connected: boolean;
    checked: boolean;
    readyReceived: boolean;
    domSignalReceived: boolean;
    pingSent: boolean;
    pongReceived: boolean;
    version?: string;
    protocolVersion?: string;
    browser: string;
    capabilities: string[];
    requestId?: string;
    lastCheckedAt?: string;
    failureReason?: ExtensionFailureReason;
    message: string;
  };
  type ExtensionScanState = {
    status?: "idle" | "scanning" | "paused" | "completed" | "error";
    stage?: string;
    mode?: "limit" | "all";
    limit?: number | null;
    batch?: number;
    lastAdded?: number;
    noNewRounds?: number;
    duplicateCount?: number;
    missingLinkCount?: number;
    missingTitleCount?: number;
    totalFound?: number;
    selectedCount?: number;
    items?: unknown[];
    message?: string;
    pageUrl?: string;
    updatedAt?: string;
    error?: string;
    milestones?: string[];
    selectorVersion?: string;
  };
  const handshakeRequestRef = useRef("");
  const timeoutRef = useRef<number | undefined>(undefined);
  const retryTimersRef = useRef<number[]>([]);
  const [selectedGuide, setSelectedGuide] = useState<"chrome" | "edge">("chrome");
  const [scanState, setScanState] = useState<ExtensionScanState | undefined>();
  const [syncState, setSyncState] = useState<"idle" | "restoring" | "syncing" | "synced" | "failed">("idle");
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>({
    connected: false,
    checked: false,
    readyReceived: false,
    domSignalReceived: false,
    pingSent: false,
    pongReceived: false,
    browser: detectBrowserName(),
    capabilities: [],
    message: "还没有检测扩展。安装后点击“检测扩展连接”，或刷新这个页面。"
  });

  function pingExtension() {
    const requestId = createHandshakeRequestId();
    handshakeRequestRef.current = requestId;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    window.postMessage({
      source: EXTENSION_WEB_SOURCE,
      type: "COLLECTION_REVIVAL_EXTENSION_PING",
      requestId,
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
      webVersion: EXTENSION_BETA_VERSION,
      timestamp: new Date().toISOString()
    }, window.location.origin);
    setExtensionStatus((current) => ({
      ...current,
      connected: false,
      checked: true,
      pingSent: true,
      pongReceived: false,
      requestId,
      lastCheckedAt: new Date().toLocaleString(),
      failureReason: undefined,
      message: "正在检测扩展连接。v0.2.2 会返回带 requestId 的 PONG。"
    }));
    timeoutRef.current = window.setTimeout(() => {
      setExtensionStatus((current) => current.pongReceived
        ? current
        : {
            ...current,
            connected: false,
            checked: true,
            failureReason: current.readyReceived ? "HANDSHAKE_TIMEOUT" : "PAGE_REFRESH_REQUIRED",
            message: current.readyReceived
              ? "扩展脚本已出现过，但这次没有收到 PONG。请在扩展管理页点击重新加载，再刷新本页后检测。"
              : "扩展可能已经安装，但当前网页还没有加载连接脚本。请刷新本页面后再次检测；如果仍失败，请点浏览器扩展图标里的“打开或刷新收藏复活扫描页”。"
          }
      );
    }, 3000);
  }

  function requestScanStatus(requestId = `scan-status-${Date.now()}`) {
    setSyncState("syncing");
    window.postMessage({
      source: EXTENSION_WEB_SOURCE,
      type: "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS_REQUEST",
      requestId,
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
      webVersion: EXTENSION_BETA_VERSION,
      timestamp: new Date().toISOString()
    }, window.location.origin);
  }

  function scheduleReconnect(reason: string) {
    retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    retryTimersRef.current = [];
    setSyncState("restoring");
    [0, 300, 800, 1500, 3000].forEach((delay, index) => {
      const timer = window.setTimeout(() => {
        const requestId = `${reason}-${Date.now()}-${index}`;
        pingExtension();
        requestScanStatus(requestId);
        if (index === 4) {
          window.setTimeout(() => setSyncState((current) => current === "synced" ? current : "failed"), 1800);
        }
      }, delay);
      retryTimersRef.current.push(timer);
    });
  }

  useEffect(() => {
    function applyDomSignal() {
      const signal = readExtensionDomSignal();
      if (!signal) return;
      setExtensionStatus((current) => ({
        ...current,
        checked: true,
        domSignalReceived: true,
        readyReceived: current.readyReceived,
        version: current.version || signal.version,
        protocolVersion: current.protocolVersion || signal.protocolVersion,
        browser: current.browser || signal.browser || detectBrowserName(),
        failureReason: signal.version && signal.version !== EXTENSION_BETA_VERSION ? "EXTENSION_VERSION_TOO_OLD" : current.failureReason,
        message: current.connected
          ? current.message
          : signal.version && signal.version !== EXTENSION_BETA_VERSION
            ? `检测到旧版扩展 v${signal.version}，请下载 v${EXTENSION_BETA_VERSION}，并在扩展管理页重新加载。`
            : "已发现扩展脚本痕迹。请点击“检测扩展”，完成 PING / PONG 握手。"
      }));
    }

    function handleBridgeEvent() {
      applyDomSignal();
    }

    function handleExtensionMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== EXTENSION_SOURCE) return;
      if (!["COLLECTION_REVIVAL_EXTENSION_READY", "COLLECTION_REVIVAL_EXTENSION_PONG", "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS"].includes(event.data?.type)) return;

      if (event.data.type === "COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS") {
        setScanState(event.data.scanState || undefined);
        setSyncState("synced");
        return;
      }

      const version = String(event.data.extensionVersion || event.data.version || "");
      const protocolVersion = String(event.data.protocolVersion || "");
      const capabilities = Array.isArray(event.data.capabilities) ? event.data.capabilities.map(String) : [];
      const browser = String(event.data.browser || detectBrowserName());
      const versionTooOld = version !== EXTENSION_BETA_VERSION;
      const protocolMismatch = Boolean(protocolVersion && protocolVersion !== EXTENSION_PROTOCOL_VERSION);
      const isPong = event.data.type === "COLLECTION_REVIVAL_EXTENSION_PONG";
      const requestMatches = isPong && event.data.requestId && event.data.requestId === handshakeRequestRef.current;

      setExtensionStatus((current) => ({
        ...current,
        connected: requestMatches && !versionTooOld && !protocolMismatch,
        checked: true,
        readyReceived: true,
        domSignalReceived: current.domSignalReceived || Boolean(readExtensionDomSignal()),
        pongReceived: current.pongReceived || Boolean(requestMatches),
        version,
        protocolVersion,
        browser,
        capabilities,
        failureReason: versionTooOld ? "EXTENSION_VERSION_TOO_OLD" : protocolMismatch ? "PROTOCOL_VERSION_MISMATCH" : requestMatches ? undefined : current.failureReason,
        message: versionTooOld
          ? `检测到旧版扩展 v${version || "未知"}，请下载 v${EXTENSION_BETA_VERSION}，并在扩展管理页重新加载。`
          : protocolMismatch
            ? "扩展协议版本不一致，请下载最新 ZIP 并重新加载扩展。"
            : requestMatches
              ? `扩展已连接 · v${version}`
              : "已收到扩展 READY。请点击“检测扩展”，完成 PING / PONG 握手。"
      }));
      if (requestMatches || event.data.type === "COLLECTION_REVIVAL_EXTENSION_READY") {
        requestScanStatus(event.data.requestId || `bridge-${Date.now()}`);
      }
    }
    window.addEventListener("collection-revival-extension-bridge", handleBridgeEvent);
    window.addEventListener("message", handleExtensionMessage);
    applyDomSignal();
    pingExtension();
    requestScanStatus("initial-scan-status");
    const restoreOnFocus = () => scheduleReconnect("page-visible");
    const restoreOnVisibility = () => {
      if (document.visibilityState === "visible") scheduleReconnect("visibility");
    };
    window.addEventListener("focus", restoreOnFocus);
    window.addEventListener("pageshow", restoreOnFocus);
    document.addEventListener("visibilitychange", restoreOnVisibility);
    const timer = window.setTimeout(() => {
      applyDomSignal();
      setExtensionStatus((current) => current.readyReceived || current.domSignalReceived ? current : { ...current, checked: true, failureReason: "CONTENT_SCRIPT_NOT_INJECTED" });
    }, 1000);
    return () => {
      window.removeEventListener("collection-revival-extension-bridge", handleBridgeEvent);
      window.removeEventListener("message", handleExtensionMessage);
      window.removeEventListener("focus", restoreOnFocus);
      window.removeEventListener("pageshow", restoreOnFocus);
      document.removeEventListener("visibilitychange", restoreOnVisibility);
      window.clearTimeout(timer);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      retryTimersRef.current.forEach((retryTimer) => window.clearTimeout(retryTimer));
    };
  }, []);

  function refreshAndDetect() {
    window.location.reload();
  }

  function copyDiagnostics() {
    const report = [
      "收藏复活扩展连接诊断",
      `当前浏览器：${extensionStatus.browser}`,
      `Web 版本：${EXTENSION_BETA_VERSION}`,
      `Web 协议版本：${EXTENSION_PROTOCOL_VERSION}`,
      `扩展 READY 是否收到：${extensionStatus.readyReceived ? "是" : "否"}`,
      `DOM 诊断信号是否收到：${extensionStatus.domSignalReceived ? "是" : "否"}`,
      `PING 是否发出：${extensionStatus.pingSent ? "是" : "否"}`,
      `PONG 是否收到：${extensionStatus.pongReceived ? "是" : "否"}`,
      `扩展版本：${extensionStatus.version || "未检测到"}`,
      `扩展协议版本：${extensionStatus.protocolVersion || "未检测到"}`,
      `最后一次 requestId：${extensionStatus.requestId || "无"}`,
      `最后一次检测时间：${extensionStatus.lastCheckedAt || "未检测"}`,
      `当前失败原因：${extensionStatus.failureReason || "无"}`,
      `扩展能力：${extensionStatus.capabilities.join(", ") || "未检测到"}`,
      `扫描同步状态：${syncState}`,
      `扫描状态：${scanState?.status || "未同步"}`,
      `扫描阶段：${scanState?.stage || "未同步"}`,
      `已发现数量：${scanState?.totalFound ?? scanState?.items?.length ?? 0}`,
      `待导入数量：${scanState?.selectedCount ?? 0}`,
      `最近更新时间：${scanState?.updatedAt || "无"}`
    ].join("\n");
    void navigator.clipboard?.writeText(report);
  }

  const guideSteps = selectedGuide === "chrome"
    ? [
        "下载并解压 ZIP。",
        "打开 chrome://extensions。",
        "在页面右上角开启“开发者模式”。",
        "点击页面左上角“加载未打包的扩展程序”。",
        "选择解压后、直接包含 manifest.json 的文件夹。",
        "确认扩展开关已开启。",
        "回到收藏复活网页并刷新。",
        "点击“检测扩展”。"
      ]
    : [
        "下载并解压 ZIP。",
        "打开 edge://extensions。",
        "在页面左下角开启“开发人员模式”。",
        "点击页面上方“加载解压缩的扩展”。",
        "选择解压后、直接包含 manifest.json 的文件夹。",
        "确认扩展开关已开启。",
        "回到收藏复活网页并刷新。",
        "点击“检测扩展”。"
      ];
  const statusClass = extensionStatus.connected ? "extension-connection-card connected" : extensionStatus.failureReason ? "extension-connection-card warning" : "extension-connection-card";
  const scanTotal = scanState?.totalFound ?? scanState?.items?.length ?? 0;
  const scanLimit = scanState?.limit || undefined;
  const scanPercent = scanState?.mode === "all" || !scanLimit ? undefined : Math.min(100, Math.round((scanTotal / Math.max(1, scanLimit)) * 100));
  const scanStageText = ({
    recognizing: "识别页面",
    loading: "加载收藏",
    extracting: "提取卡片",
    deduping: "清理去重",
    complete: "扫描完成",
    error: "扫描异常"
  } as Record<string, string>)[scanState?.stage || ""] || "等待同步";
  const syncText = syncState === "restoring"
    ? "正在恢复连接..."
    : syncState === "syncing"
      ? "正在同步刚才的扫描结果..."
      : syncState === "synced"
        ? "扫描结果已同步"
        : syncState === "failed"
          ? "暂时没有同步成功，可点击重新连接。"
          : "等待扩展同步";

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
          <span><Sparkles size={18} /> 桌面浏览器扩展 Beta</span>
          <strong>旧收藏扫描是主入口，但当前仍需要先安装本地 Beta 扩展。网页本身不会读取你的小红书收藏夹。</strong>
          <small>推荐版本 v{EXTENSION_BETA_VERSION}。扩展只在你本人登录的小红书网页版、你主动点击扫描后，读取当前已加载 DOM 中的标题、链接、封面、作者和可见短文本。不做云端爬虫，不模拟登录，不绕过验证码。</small>
        </div>
        <a className="primary-button" href={`/downloads/${EXTENSION_ZIP_FILE_NAME}`} download={EXTENSION_ZIP_FILE_NAME}>下载旧收藏扫描 Beta ZIP</a>
      </section>

      <section className="tool-panel single">
        <div className="section-heading-soft">
          <span><ClipboardList size={18} /> 安装助手</span>
          <small>当前是本地 Beta，普通用户只需要下载 ZIP、解压、加载文件夹，不需要接触源码目录。</small>
        </div>
        <div className={statusClass} data-testid="extension-connection-status">
          <strong>{extensionStatus.connected ? `扩展已连接 · v${extensionStatus.version}` : extensionStatus.failureReason === "EXTENSION_VERSION_TOO_OLD" ? "检测到旧版扩展" : "扩展未连接"}</strong>
          <span>{extensionStatus.message}</span>
        </div>
        {extensionStatus.failureReason && (
          <div className="extension-connection-hint">
            <strong>{extensionStatus.failureReason}</strong>
            <span>{extensionStatus.failureReason === "PAGE_REFRESH_REQUIRED"
              ? "加载或重新加载扩展后，已经打开的网页通常需要刷新一次，content script 才会注入。"
              : "请按下方安装步骤确认扩展开关、版本和重新加载状态。也可以点击扩展图标里的“打开或刷新收藏复活扫描页”让扩展主动刷新并注入连接脚本。"}</span>
          </div>
        )}
        <div className="install-tabs">
          <button className={selectedGuide === "chrome" ? "active" : ""} onClick={() => setSelectedGuide("chrome")}>我使用 Chrome</button>
          <button className={selectedGuide === "edge" ? "active" : ""} onClick={() => setSelectedGuide("edge")}>我使用 Edge</button>
        </div>
        <ol className="install-steps">
          {guideSteps.map((step, index) => (
            <li key={step}><strong>第{index + 1}步：</strong><span>{step}</span></li>
          ))}
        </ol>
        <div className="old-import-actions">
          <button className="secondary-action" onClick={() => navigator.clipboard?.writeText("chrome://extensions/")}>复制 chrome://extensions</button>
          <button className="secondary-action" onClick={() => navigator.clipboard?.writeText("edge://extensions/")}>复制 edge://extensions</button>
          <button className="secondary-action" onClick={pingExtension} data-testid="detect-extension">我已安装，检测扩展</button>
          <button className="secondary-action" onClick={refreshAndDetect}>刷新并重新检测</button>
          <a className="primary-button" href="https://www.xiaohongshu.com/user/profile" target="_blank" rel="noreferrer">打开小红书收藏页</a>
        </div>
      </section>

      <section className="tool-panel single extension-progress-mirror" data-testid="extension-scan-progress">
        <div className="section-heading-soft">
          <span><Sparkles size={18} /> 扫描进度同步</span>
          <small>{syncText}</small>
        </div>
        <div className={`extension-progress-track ${scanState?.mode === "all" && scanState?.status === "scanning" ? "indeterminate" : ""}`}>
          <span style={{ width: `${scanPercent ?? (scanState?.status === "completed" ? 100 : 35)}%` }} />
        </div>
        <div className="qa-grid">
          <Metric label="扫描状态" value={scanState?.status === "scanning" ? "正在扫描" : scanState?.status === "paused" ? "已暂停" : scanState?.status === "completed" ? "已完成" : scanState?.status === "error" ? "异常" : "未开始"} />
          <Metric label="当前阶段" value={scanStageText} />
          <Metric label="已发现" value={scanTotal.toString()} />
          <Metric label="本轮新增" value={(scanState?.lastAdded ?? 0).toString()} />
          <Metric label="扫描批次" value={(scanState?.batch ?? 0).toString()} />
          <Metric label="待导入" value={(scanState?.selectedCount ?? 0).toString()} />
          <Metric label="重复" value={(scanState?.duplicateCount ?? 0).toString()} />
          <Metric label="有链接" value={Math.max(0, scanTotal - (scanState?.missingLinkCount ?? 0)).toString()} />
          <Metric label="缺标题" value={(scanState?.missingTitleCount ?? 0).toString()} />
          <Metric label="缺链接" value={(scanState?.missingLinkCount ?? 0).toString()} />
          <Metric label="最近更新" value={scanState?.updatedAt ? new Date(scanState.updatedAt).toLocaleTimeString() : "未同步"} />
        </div>
        <div className="old-import-actions">
          <button className="secondary-action" onClick={() => scheduleReconnect("manual-sync")}>重新连接并同步</button>
          <button className="secondary-action" onClick={() => requestScanStatus()}>只同步扫描状态</button>
        </div>
      </section>

      <details className="tool-panel single extension-diagnostics" data-testid="extension-diagnostics">
        <summary>连接诊断</summary>
        <div className="diagnostic-grid">
          <Metric label="当前浏览器" value={extensionStatus.browser} />
          <Metric label="Web 版本" value={EXTENSION_BETA_VERSION} />
          <Metric label="Web 协议版本" value={EXTENSION_PROTOCOL_VERSION} />
          <Metric label="READY" value={extensionStatus.readyReceived ? "已收到" : "未收到"} />
          <Metric label="DOM 信号" value={extensionStatus.domSignalReceived ? "已看到" : "未看到"} />
          <Metric label="PING" value={extensionStatus.pingSent ? "已发出" : "未发出"} />
          <Metric label="PONG" value={extensionStatus.pongReceived ? "已收到" : "未收到"} />
          <Metric label="扩展版本" value={extensionStatus.version || "未检测到"} />
          <Metric label="扩展协议" value={extensionStatus.protocolVersion || "未检测到"} />
          <Metric label="requestId" value={extensionStatus.requestId || "无"} />
          <Metric label="最后检测" value={extensionStatus.lastCheckedAt || "未检测"} />
          <Metric label="可能需刷新" value={!extensionStatus.readyReceived ? "是" : "否"} />
          <Metric label="失败原因" value={extensionStatus.failureReason || "无"} />
          <Metric label="旧版扩展" value={extensionStatus.version && extensionStatus.version !== EXTENSION_BETA_VERSION ? "是" : "否"} />
        </div>
        <button className="secondary-action" onClick={copyDiagnostics}>复制诊断报告</button>
      </details>

      <section className="tool-panel single">
        <div className="section-heading-soft">
          <span><Sparkles size={18} /> 扫描控制台状态</span>
          <small>这些状态会在扩展 popup 和导入批次里体现</small>
        </div>
        <div className="qa-grid">
          <Metric label="未安装" value="下载 Beta" />
          <Metric label="未打开收藏页" value="先打开小红书" />
          <Metric label="可以扫描" value="开始扫描" />
          <Metric label="扫描中" value="可暂停" />
          <Metric label="暂停" value="可继续" />
          <Metric label="完成" value="确认导入" />
          <Metric label="已导入" value="生成索引" />
          <Metric label="部分失败" value="可重试" />
        </div>
      </section>

      <div className="old-import-actions">
        <button className="primary-button" onClick={() => props.setActiveView("import")}>没有扩展？先用新收藏导入测试</button>
        <button className="secondary-action" onClick={() => props.setActiveView("albums")}>查看智能专辑</button>
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
}

function SearchView(props: {
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

  function updateLocalQuery(value: string) {
    setLocalQuery(value);
    if (typeof window !== "undefined" && window.location.pathname === "/search") {
      const clean = value.trim();
      window.history.replaceState(null, "", clean ? `/search?q=${encodeURIComponent(clean)}` : "/search");
    }
  }

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
        <input value={localQuery} onChange={(event) => updateLocalQuery(event.target.value)} placeholder="试试搜：大理、剪辑、低卡晚餐、周末去处、AI工具" />
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
  const actionCardItemIds = new Set(props.actionCards.map((card) => card.savedItemId));
  const statRows = [
    { label: "全部收藏", value: props.allItems.length },
    { label: "尚未复活", value: props.allItems.filter((item) => !actionCardItemIds.has(item.id)).length },
    { label: "已有行动卡", value: actionCardItemIds.size },
    { label: "已加入计划", value: props.allItems.filter((item) => item.status === "today").length },
    { label: "已完成", value: props.allItems.filter((item) => item.status === "completed").length }
  ];
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">收藏池</p>
          <h1>收藏池</h1>
        </div>
        <p className="page-lead">这里整理扫描和导入的收藏。需要时，再选择一条复活。</p>
      </div>

      <section className="album-overview-grid">
        {statRows.map((stat) => <Metric key={stat.label} label={stat.label} value={stat.value.toString()} />)}
      </section>

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
                    <strong>{formatItemTitle(item)}</strong>
                    <small>{formatItemSummary(item)}</small>
                  </td>
                  <td>{formatCategoryLabel(item)}</td>
                  <td>{DISPLAY_STATUS_LABELS[item.status]}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button onClick={() => props.viewActionCard(item.id)}>查看</button>
                      {hasSourceUrl(item) ? <button onClick={() => props.openSource(item)}>原帖</button> : <button disabled>暂无原帖</button>}
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


function SavedIndexDetailView(props: {
  item: SavedItem;
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  updateSavedNote: (itemId: string, userNote: string) => void;
  reviveSavedItem: (itemId: string, reviveIntent?: ReviveIntent) => void;
  setActiveView: (view: ViewKey) => void;
  onContinueImport: () => void;
}) {
  const [noteDraft, setNoteDraft] = useState(props.item.userNote);
  const lowConfidence = props.item.confidence === "low";

  function saveNote() {
    props.updateSavedNote(props.item.id, noteDraft);
  }

  return (
    <>
      <div className="detail-hero">
        <div>
          <p className="eyebrow">{props.item.contentDomain} / {props.item.contentSubDomain} · 用途：{props.item.savedIntent} · {lowConfidence ? "低置信" : "尚未复活"}</p>
          <h1>{formatItemTitle(props.item)}</h1>
          <p>{formatItemSummary(props.item)}</p>
          <p className="quiet-copy">{props.item.whyThisDomain}</p>
          <p className="quiet-copy">{props.item.whyThisIntent}</p>
          {lowConfidence && <p className="quiet-copy">这条收藏信息较少。补一句你为什么收藏它，再选择一个复活用途，行动卡会更具体。</p>}
        </div>
        <div className="detail-actions">
          <button className="secondary-action" onClick={props.onContinueImport} data-testid="detail-continue-import">继续导入一条</button>
          <button className="secondary-action" onClick={() => props.setActiveView("import")}>回到导入中心</button>
          <button className="secondary-action" onClick={() => props.setActiveView("albums")}>查看智能专辑</button>
          {hasSourceUrl(props.item) ? (
            <button className="icon-text-button" onClick={() => props.openSource(props.item)} data-testid="detail-open-source">
              <ExternalLink size={17} />
              打开原帖
            </button>
          ) : (
            <button className="icon-text-button" disabled data-testid="detail-open-source-unavailable">
              <ExternalLink size={17} />
              暂无原帖链接
            </button>
          )}
        </div>
      </div>

      <div className="detail-layout">
        <section className="tool-panel single">
          <PanelHeader icon={<Sparkles size={18} />} title="你准备拿它做什么？" meta="选择后再生成行动卡" />
          <p className="quiet-copy">导入后这里只先保存收藏索引，不自动制造任务。等你真的想动它时，选择一个用途，系统再生成一张更贴近场景的行动卡。</p>
          <div className="status-buttons revive-intent-buttons">
            {REVIVE_INTENTS.map((intent) => (
              <button key={intent} onClick={() => props.reviveSavedItem(props.item.id, intent)} data-testid="revive-intent-option">
                {intent}
              </button>
            ))}
          </div>
        </section>

        <aside className="detail-side">
          <section className="tool-panel">
            <PanelHeader icon={<Archive size={18} />} title="收藏索引" meta={formatDate(props.item.createdAt)} />
            <div className="field-grid compact-fields">
              <div className="field-card"><span>内容主题</span><strong>{props.item.contentDomain} / {props.item.contentSubDomain}</strong></div>
              <div className="field-card"><span>收藏用途</span><strong>{props.item.savedIntent}</strong></div>
              <div className="field-card"><span>置信度</span><strong>{confidenceLabel(props.item.confidence)}</strong></div>
            </div>
            <div className="tag-list">
              {props.item.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
            <div className="entity-list">
              {props.item.entities.map((entity) => <span key={`${entity.type}-${entity.value}`}>{entityLabel(entity.type)}：{entity.value}</span>)}
            </div>
            <label className="edit-field">
              <span>我收藏它是因为...</span>
              <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="例如：想复现这个方法 / 想写成内容 / 想周末去" />
            </label>
            <button className="secondary-action" onClick={saveNote}>保存备注</button>
          </section>
        </aside>
      </div>
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
  addActionCardToPlan: (cardId: string) => void;
  setActiveView: (view: ViewKey) => void;
  onContinueImport: () => void;
}) {
  const [noteDraft, setNoteDraft] = useState(props.item.userNote);
  const lowConfidence = props.item.classificationConfidence === "low";
  function saveNoteAndRegenerate() {
    props.updateSavedNote(props.item.id, noteDraft);
    window.setTimeout(() => props.regenerateActionCard(props.item.id), 0);
  }

  return (
    <>
      <div className="detail-hero">
        <div>
          <p className="eyebrow">{props.item.category} / {props.item.subCategory} · 信心：{confidenceLabel(props.item.classificationConfidence)} · {DISPLAY_STATUS_LABELS[props.item.status]}</p>
          <input className="detail-title-input" value={props.card.title} onChange={(event) => props.updateCardField(props.card.id, "title", event.target.value)} />
          <p>{props.item.summary}</p>
          <p className="quiet-copy">{props.item.whyThisCategory}</p>
          {lowConfidence && <p className="quiet-copy">这条收藏信息较少，分类可能不准，可以补充一句备注后重新生成。</p>}
        </div>
        <div className="detail-actions">
          <button className="primary-button" onClick={() => props.changeStatus(props.item.id, "today")} data-testid="add-to-today">
            <CalendarCheck size={17} />
            加入今日
          </button>
          <button className="secondary-action" onClick={props.onContinueImport} data-testid="detail-continue-import">继续导入一条</button>
          <button className="secondary-action" onClick={() => props.addActionCardToPlan(props.card.id)} data-testid="add-to-plan-card">加入计划</button>
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

          <div className="field-grid compact-fields">
            <div className="field-card"><span>为什么值得复活</span><strong>{props.card.whySaved}</strong></div>
            <div className="field-card"><span>打开原帖后重点看</span><strong>{props.card.openOriginalFocus.join(" / ")}</strong></div>
            <div className="field-card"><span>这一步的产出</span><strong>{props.card.output}</strong></div>
            <div className="field-card"><span>完成标准</span><strong>{props.card.doneCriteria}</strong></div>
            <div className="field-card"><span>避免</span><strong>{props.card.avoidDoing}</strong></div>
            <div className="field-card"><span>后续</span><strong>{props.card.followUp}</strong></div>
          </div>

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
            {lowConfidence && (
              <div className="low-info-box">
                <label className="edit-field">
                  <span>我收藏它是因为...</span>
                  <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="例如：下周末想去 / 想复现这个工具 / 想借鉴封面" />
                </label>
                <button className="secondary-action" onClick={saveNoteAndRegenerate}>补充备注并重新生成</button>
                <p className="quiet-copy">{props.card.ifInfoMissing}</p>
              </div>
            )}
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
        <p className="page-lead">计划库已从主流程降级：先整理旧收藏和复活单条行动，只有用户主动把行动卡加入计划时，这里才承接 3 天、7 天或 30 天节奏。</p>
      </div>

      <div className="plans-grid">
        {props.plans.length === 0 && <EmptyState title="计划库暂时收起" text="当前阶段不再自动把每条收藏排成计划，先从智能专辑里挑 1 条复活会更轻。后续需要 3 天/7 天计划时，再从行动卡主动加入。" />}
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
  confirmAlbum: (albumId: string, options?: { autoCollectEnabled?: boolean; mediumMatchRequiresApproval?: boolean }) => void;
  archiveAlbum: (albumId: string) => void;
  restoreAlbum: (albumId: string) => void;
  acceptSuggestedItem: (albumId: string, itemId: string) => void;
  rejectSuggestedItem: (albumId: string, itemId: string) => void;
  acceptAllSuggestedItems: (albumId: string) => void;
  regenerateSmartAlbums: () => void;
  correctSavedItemClassification: (itemId: string, mode: "domain" | "intent") => void;
  selectedAlbumId?: string;
  onSelectAlbum: (albumId: string) => void;
  removeItemFromAlbum: (albumId: string, itemId: string) => void;
  moveItemToTheme: (itemId: string) => void;
  addItemToIntentAlbum: (itemId: string) => void;
  bulkCorrectAlbumItems: (itemIds: string[], mode: "domain" | "intent") => void;
  createManualAlbum: () => void;
  undoLastClassificationChange: () => void;
  canUndoClassificationChange: boolean;
  albumFilter: "candidate" | "confirmed" | "suggested" | "archived";
  setAlbumFilter: (value: "candidate" | "confirmed" | "suggested" | "archived") => void;
}) {
  const [confirmingAlbum, setConfirmingAlbum] = useState<SmartAlbum | null>(null);
  const [confirmAutoCollect, setConfirmAutoCollect] = useState(true);
  const [confirmMediumRequiresApproval, setConfirmMediumRequiresApproval] = useState(true);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const candidateCount = props.albums.filter((album) => album.status === "candidate").length;
  const confirmedCount = props.albums.filter((album) => album.status === "confirmed").length;
  const suggestedCount = props.albums.reduce((count, album) => count + (album.suggestedItemIds?.length ?? 0), 0);
  const archivedCount = props.albums.filter((album) => album.status === "archived").length;
  const confirmedItemIds = new Set(props.albums.filter((album) => album.status === "confirmed").flatMap((album) => album.savedItemIds));
  const visibleAlbums = props.albums.filter((album) => {
    if (props.albumFilter === "suggested") return (album.suggestedItemIds?.length ?? 0) > 0;
    return album.status === props.albumFilter;
  });
  const selectedAlbum = props.albums.find((album) => album.id === props.selectedAlbumId) ?? visibleAlbums[0];
  const selectedItems = selectedAlbum
    ? selectedAlbum.savedItemIds
        .map((id) => props.savedItems.find((item) => item.id === id))
        .filter((item): item is SavedItem => Boolean(item))
    : [];
  const suggestedItems = selectedAlbum
    ? (selectedAlbum.suggestedItemIds ?? [])
        .map((id) => props.savedItems.find((item) => item.id === id))
        .filter((item): item is SavedItem => Boolean(item))
    : [];

  useEffect(() => {
    setSelectedItemIds([]);
  }, [selectedAlbum?.id]);

  function openConfirmModal(album: SmartAlbum) {
    setConfirmingAlbum(album);
    setConfirmAutoCollect(album.autoCollectEnabled ?? true);
    setConfirmMediumRequiresApproval(album.mediumMatchRequiresApproval ?? true);
  }

  function submitConfirmAlbum() {
    if (!confirmingAlbum) return;
    props.confirmAlbum(confirmingAlbum.id, {
      autoCollectEnabled: confirmAutoCollect,
      mediumMatchRequiresApproval: confirmMediumRequiresApproval
    });
    setConfirmingAlbum(null);
    props.setAlbumFilter("confirmed");
  }

  function toggleSelectedItem(itemId: string) {
    setSelectedItemIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  function bulkRemoveSelected() {
    if (!selectedAlbum) return;
    selectedItemIds.forEach((itemId) => props.removeItemFromAlbum(selectedAlbum.id, itemId));
    setSelectedItemIds([]);
  }

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
        <Metric label="待确认" value={candidateCount.toString()} />
        <Metric label="已确认" value={confirmedCount.toString()} />
        <Metric label="待确认新增" value={suggestedCount.toString()} />
        <Metric label="已归档" value={archivedCount.toString()} />
        <Metric label="待处理收藏" value={Math.max(0, props.savedItems.length - confirmedItemIds.size).toString()} />
      </section>

      <div className="album-status-tabs" data-testid="album-status-tabs">
        <button className={props.albumFilter === "candidate" ? "active" : ""} onClick={() => props.setAlbumFilter("candidate")}>待确认</button>
        <button className={props.albumFilter === "confirmed" ? "active" : ""} onClick={() => props.setAlbumFilter("confirmed")}>已确认</button>
        <button className={props.albumFilter === "suggested" ? "active" : ""} onClick={() => props.setAlbumFilter("suggested")}>待确认新增</button>
        <button className={props.albumFilter === "archived" ? "active" : ""} onClick={() => props.setAlbumFilter("archived")}>已归档</button>
      </div>

      <section className="extension-import-guide">
        <div>
          <span><Sparkles size={18} /> 导入 → 整理成专辑 → 选择今日行动</span>
          <strong>旧收藏扫描或手动导入后，都会先进入统一导入管线，再生成专辑候选。</strong>
          <small>完整原帖内容仍然通过 sourceUrl 回到原平台查看，本产品只保存用户确认导入后的索引、摘要和行动卡。</small>
        </div>
        <button className="secondary-action" onClick={props.regenerateSmartAlbums}>重新整理专辑</button>
        <button className="secondary-action" onClick={props.createManualAlbum}>新建专辑</button>
      </section>

      <div className="smart-album-grid">
        {visibleAlbums.map((album) => {
          const albumItems = album.savedItemIds
            .map((id) => props.savedItems.find((item) => item.id === id))
            .filter((item): item is SavedItem => Boolean(item));
          const priorityItems = ((album.recommendedItemIds ?? []).length > 0 ? album.recommendedItemIds : album.savedItemIds)
            .map((id) => props.savedItems.find((item) => item.id === id))
            .filter((item): item is SavedItem => Boolean(item))
            .slice(0, 3);

          return (
            <section className="smart-album-card" key={album.id} data-testid="smart-album-card">
              <div className="smart-album-head">
                <span>{album.albumView === "saved_intent" ? "用途专辑" : "主题专辑"} · {albumStatusLabel(album)} · {albumItems.length} 条</span>
                <strong>{album.title}</strong>
                <small>{album.description}</small>
                <small>{album.whyThisAlbum}</small>
                {album.status === "confirmed" && <small>已确认 · {album.autoCollectEnabled ? "自动收纳已开启" : "自动收纳未开启"} · 待确认新增 {(album.suggestedItemIds ?? []).length} 条</small>}
              </div>
              <div className="tag-list album-keywords">
                {album.keywords.slice(0, 6).map((keyword) => <span key={keyword}>{keyword}</span>)}
              </div>
              <p className="quiet-copy">第一步：{album.suggestedFirstAction}</p>
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
                        <button onClick={() => props.viewActionCard(item.id)}>{card ? "查看卡片" : "复活这条"}</button>
                        {hasSourceUrl(item) ? <button onClick={() => props.openSource(item)}>原帖</button> : <button disabled>暂无原帖</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="album-actions">
                <button className="secondary-action" onClick={() => props.onSelectAlbum(album.id)} data-testid="view-album-items">查看并整理</button>
                {album.status === "confirmed" ? (
                  <button className="primary-button" disabled data-testid="confirm-album">已确认</button>
                ) : album.status === "archived" ? (
                  <>
                    <button className="secondary-action" onClick={() => props.restoreAlbum(album.id)} data-testid="restore-album">恢复为候选</button>
                    <button className="primary-button" onClick={() => openConfirmModal(album)} data-testid="confirm-album">直接确认</button>
                  </>
                ) : (
                  <button className="primary-button" onClick={() => openConfirmModal(album)} data-testid="confirm-album">确认这个专辑</button>
                )}
                {album.status !== "archived" && (
                  <details className="album-more-menu">
                    <summary>更多</summary>
                    <button onClick={() => props.renameAlbum(album.id)}>改名</button>
                    <button onClick={() => props.archiveAlbum(album.id)} data-testid="archive-album">归档这个候选</button>
                  </details>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {selectedAlbum && (
        <section className="tool-panel single album-detail-panel" data-testid="album-detail">
          <PanelHeader icon={<LayoutGrid size={18} />} title={`${selectedAlbum.title} · 全部收藏`} meta={`${selectedItems.length} 条`} />
          <div className="field-grid compact-fields">
            <div className="field-card"><span>专辑类型</span><strong>{selectedAlbum.albumView === "saved_intent" ? "用途专辑" : "主题专辑"}</strong></div>
            <div className="field-card"><span>当前状态</span><strong>{albumStatusLabel(selectedAlbum)}</strong></div>
            <div className="field-card"><span>为什么在一起</span><strong>{selectedAlbum.whyThisAlbum}</strong></div>
            <div className="field-card"><span>匹配依据</span><strong>{formatAlbumMatchProfile(selectedAlbum)}</strong></div>
            <div className="field-card"><span>自动收纳</span><strong>{selectedAlbum.autoCollectEnabled ? "高度匹配自动加入" : "未开启"}{selectedAlbum.mediumMatchRequiresApproval ? "；中匹配待确认" : ""}</strong></div>
            <div className="field-card"><span>待确认新增</span><strong>{suggestedItems.length} 条</strong></div>
            <div className="field-card"><span>推荐先看</span><strong>{selectedAlbum.whyStartHere}</strong></div>
            <div className="field-card"><span>第一步</span><strong>{selectedAlbum.suggestedFirstAction}</strong></div>
          </div>
          <div className="album-actions">
            <button className="secondary-action" onClick={() => props.renameAlbum(selectedAlbum.id)}>改名</button>
            <button className="secondary-action" onClick={() => openConfirmModal(selectedAlbum)} disabled={selectedAlbum.status === "confirmed"}>
              {selectedAlbum.status === "confirmed" ? "已确认" : "确认这个专辑"}
            </button>
            {selectedAlbum.status === "archived" ? <button className="secondary-action" onClick={() => props.restoreAlbum(selectedAlbum.id)}>恢复为候选</button> : <button className="ghost-action" onClick={() => props.archiveAlbum(selectedAlbum.id)}>归档这个候选</button>}
            <button className="ghost-action" onClick={props.undoLastClassificationChange} disabled={!props.canUndoClassificationChange}>撤销上次分类修改</button>
          </div>
          {suggestedItems.length > 0 && (
            <section className="suggested-items-panel" data-testid="suggested-items-panel">
              <div className="section-heading-soft">
                <span>待确认新增</span>
                <button className="secondary-action" onClick={() => props.acceptAllSuggestedItems(selectedAlbum.id)}>全部加入</button>
              </div>
              {suggestedItems.map((item) => (
                <article className="qa-result-row" key={item.id}>
                  <div>
                    <strong>{formatItemTitle(item)}</strong>
                    <small>{item.contentDomain} / {item.contentSubDomain} · 用途：{item.savedIntent}</small>
                  </div>
                  <div className="qa-row-actions">
                    <button onClick={() => props.acceptSuggestedItem(selectedAlbum.id, item.id)}>加入</button>
                    <button onClick={() => props.moveItemToTheme(item.id)}>移到其他主题</button>
                    <button onClick={() => props.addItemToIntentAlbum(item.id)}>添加到其他用途专辑</button>
                    <button onClick={() => props.rejectSuggestedItem(selectedAlbum.id, item.id)}>不属于这里</button>
                  </div>
                </article>
              ))}
            </section>
          )}
          <div className="album-bulk-actions">
            <span>已选择 {selectedItemIds.length} 条</span>
            <button onClick={() => props.bulkCorrectAlbumItems(selectedItemIds, "domain")} disabled={selectedItemIds.length === 0}>批量移动主题</button>
            <button onClick={() => props.bulkCorrectAlbumItems(selectedItemIds, "intent")} disabled={selectedItemIds.length === 0}>批量添加用途专辑</button>
            <button onClick={bulkRemoveSelected} disabled={selectedItemIds.length === 0}>批量移出当前专辑</button>
          </div>
          <div className="qa-result-list">
            {selectedItems.map((item, index) => {
              const card = props.actionCards.find((entry) => entry.savedItemId === item.id);
              return (
                <article key={item.id} className="qa-result-row">
                  <div>
                    <label className="album-select-row">
                      <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={() => toggleSelectedItem(item.id)} />
                      <strong>{index + 1}. {formatItemTitle(item)}</strong>
                    </label>
                    <small>{item.contentDomain} / {item.contentSubDomain} · 用途：{item.savedIntent} · {DISPLAY_STATUS_LABELS[item.status]}</small>
                    <span>{card?.nextAction ?? item.summary}</span>
                  </div>
                  <div className="qa-row-actions">
                    <button onClick={() => props.viewActionCard(item.id)}>{card ? "查看收藏" : "复活这条"}</button>
                    <button onClick={() => props.correctSavedItemClassification(item.id, "domain")}>改主题</button>
                    <button onClick={() => props.correctSavedItemClassification(item.id, "intent")}>改用途</button>
                    <button onClick={() => props.moveItemToTheme(item.id)}>移动到其他主题</button>
                    <button onClick={() => props.addItemToIntentAlbum(item.id)}>添加到用途专辑</button>
                    <button onClick={() => props.removeItemFromAlbum(selectedAlbum.id, item.id)}>从当前专辑移除</button>
                    {hasSourceUrl(item) ? <button onClick={() => props.openSource(item)}>原帖</button> : <button disabled>暂无原帖</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {visibleAlbums.length === 0 && <EmptyState title="还没有智能专辑" text="先从导入中心导入一条收藏，或用旧收藏扫描 Beta 导入一批已加载收藏。" />}
      {confirmingAlbum && (
        <div className="inline-modal-backdrop" role="dialog" aria-modal="true" data-testid="confirm-album-modal">
          <div className="inline-modal">
            <h2>确认这个专辑</h2>
            <p>确认后，这个专辑会长期保留。以后新导入的相似收藏可以自动加入，或先等待你确认。</p>
            <label>
              <input type="checkbox" checked={confirmAutoCollect} onChange={(event) => setConfirmAutoCollect(event.target.checked)} />
              高度匹配的收藏自动加入
            </label>
            <label>
              <input type="checkbox" checked={confirmMediumRequiresApproval} onChange={(event) => setConfirmMediumRequiresApproval(event.target.checked)} />
              中等匹配的收藏进入待确认新增
            </label>
            <div className="card-actions">
              <button className="primary-button" onClick={submitConfirmAlbum}>确认这个专辑</button>
              <button className="secondary-action" onClick={() => setConfirmingAlbum(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
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
                <small>{item.category} / {item.subCategory} · {DISPLAY_STATUS_LABELS[item.status]}</small>
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
                    <span>{formatCategoryLabel(item)}</span>
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
  clearLocalTestData: () => void;
  exportLocalData: () => void;
  reprocessLocalData: () => void;
  previewTextMigration: () => void;
  applyTextMigration: () => void;
  cancelTextMigration: () => void;
  undoTextMigration: () => void;
  textMigrationPreview: ScannedTextMigrationV3Report | null;
  canUndoTextMigration: boolean;
  themeId: ThemePresetId;
  setThemeId: (themeId: ThemePresetId) => void;
  aiStatus: AiRuntimeStatus;
  syncStatus: SyncRuntimeStatus;
  developerMode: boolean;
  setDeveloperMode: (value: boolean) => void;
  openInternalTool: (view: "qa" | "real-test") => void;
  openDataMigration: () => void;
}) {
  const [devOpen, setDevOpen] = useState(false);
  function toggleDeveloperMode(value: boolean) {
    props.setDeveloperMode(value);
    if (typeof window !== "undefined") window.localStorage.setItem("developerMode", value ? "true" : "false");
  }
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

      <MigrationDataUpgradeEntry onOpen={props.openDataMigration} />

      <section className="tool-panel single settings-list" data-testid="local-data-tools">
        <div className="settings-row">
          <span>本地测试数据管理</span>
          <strong>localStorage</strong>
        </div>
        <p className="quiet-copy">如果你之前测试过旧版本，建议先重新整理或清空本地测试数据，再验证新版分类和行动卡效果。</p>
        <div className="qa-actions">
          <button className="secondary-action" onClick={props.reprocessLocalData} data-testid="settings-reprocess-local">重新整理旧收藏</button>
          <button className="secondary-action" onClick={props.previewTextMigration} data-testid="settings-preview-text-migration">修复旧扫描文本</button>
          <button className="secondary-action" onClick={props.exportLocalData} data-testid="settings-export-local">导出本地数据</button>
          <button className="secondary-action" onClick={props.undoTextMigration} disabled={!props.canUndoTextMigration} data-testid="settings-undo-text-migration">撤销文本修复</button>
          <button className="danger-button" onClick={props.clearLocalTestData} data-testid="settings-clear-local">清空本地测试数据</button>
        </div>
        {props.textMigrationPreview && (
          <div className="migration-preview" data-testid="text-migration-preview">
            <div className="metric-grid insight-metrics">
              <Metric label="检查数量" value={props.textMigrationPreview.checkedCount.toString()} />
              <Metric label="异常数量" value={props.textMigrationPreview.abnormalCount.toString()} />
              <Metric label="将修改" value={props.textMigrationPreview.changedCount.toString()} />
              <Metric label="无法判断" value={props.textMigrationPreview.uncertainCount.toString()} />
              <Metric label="SavedItem" value={props.textMigrationPreview.savedItemCount.toString()} />
              <Metric label="ImportBatchItem" value={props.textMigrationPreview.importBatchItemCount.toString()} />
            </div>
            <div className="migration-change-list">
              {props.textMigrationPreview.changes.slice(0, 8).map((change) => (
                <article key={change.id} className={change.uncertain ? "migration-change uncertain" : "migration-change"}>
                  <span>{change.type === "SavedItem" ? "收藏" : "导入明细"} · {change.uncertain ? "需要人工确认" : "可自动修复"}</span>
                  <strong>{change.before || "空标题"} → {change.after || "标题待补充"}</strong>
                </article>
              ))}
              {props.textMigrationPreview.changes.length === 0 && <p className="quiet-copy">没有发现需要修复的旧扫描文本。</p>}
            </div>
            <div className="qa-actions">
              <button className="secondary-action" onClick={props.exportLocalData}>先导出备份</button>
              <button className="primary-button" onClick={props.applyTextMigration} data-testid="settings-apply-text-migration">应用修复</button>
              <button className="secondary-action" onClick={props.cancelTextMigration}>取消</button>
            </div>
            <p className="quiet-copy">这一步只在你点击“应用修复”后才会改写当前浏览器里的标题和搜索索引，不会自动覆盖现有数据。</p>
          </div>
        )}
      </section>

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

      <section className="tool-panel single settings-list" data-testid="developer-tools-panel">
        <button className="settings-row" onClick={() => setDevOpen((value) => !value)} aria-expanded={devOpen}>
          <span>开发与测试</span>
          <strong>内部测试工具</strong>
        </button>
        {devOpen && (
          <>
            <p className="quiet-copy">这些入口用于 QA、真实试用记录和内部诊断。普通朋友测试可以忽略；需要时可用 URL 参数 ?dev=1 或开启下面的开发者模式。</p>
            <label className="settings-row">
              <span>开发者模式</span>
              <input type="checkbox" checked={props.developerMode} onChange={(event) => toggleDeveloperMode(event.target.checked)} />
            </label>
            <div className="qa-actions">
              <button className="secondary-action" onClick={() => props.openInternalTool("qa")}>打开 QA 面板</button>
              <button className="secondary-action" onClick={() => props.openInternalTool("real-test")}>打开真实试用</button>
            </div>
          </>
        )}
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

      <section className="tool-panel single qa-panel" data-testid="qa-classification-shadow">
        <PanelHeader icon={<Sparkles size={18} />} title="分类 Shadow Mode" meta="Rule / Semantic / Hybrid" />
        {props.state.savedItems[0]?.classificationShadow ? (
          <div className="qa-status-list">
            <span>Rule：<strong>{props.state.savedItems[0].classificationShadow.rule.contentDomain} / {props.state.savedItems[0].classificationShadow.rule.contentSubDomain}</strong></span>
            <span>Semantic Top3：<strong>{props.state.savedItems[0].classificationShadow.semanticCandidates.map((candidate) => `${candidate.contentDomain}/${candidate.contentSubDomain}`).join("、")}</strong></span>
            <span>Hybrid：<strong>{props.state.savedItems[0].classificationShadow.hybrid.contentDomain} / {props.state.savedItems[0].classificationShadow.hybrid.contentSubDomain}</strong></span>
            <span>Provider：<strong>{props.state.savedItems[0].classificationShadow.provider}</strong></span>
          </div>
        ) : (
          <p className="quiet-copy">旧数据可能还没有 shadow 诊断。可以在设置里重新整理旧收藏，或新导入一条内容后查看。</p>
        )}
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
function ImportSamplePreview(props: { onUseSample: (input: ShareInput) => void }) {
  const samples: ShareInput[] = [
    {
      sourceUrl: "https://www.xiaohongshu.com/explore/sample-cover-design",
      title: "小红书封面设计技巧",
      rawShareText: "收藏一个小红书封面设计教程，适合做内容运营和图文排版参考",
      userNote: "之后做图文时想借鉴标题结构和封面构图"
    },
    {
      sourceUrl: "https://www.xiaohongshu.com/explore/sample-low-cal-dinner",
      title: "低卡晚餐备餐",
      rawShareText: "低卡晚餐和工作日备餐，包含食材、空气炸锅做法和购物清单",
      userNote: "下班后想少点外卖，先试一周"
    },
    {
      sourceUrl: "https://www.xiaohongshu.com/explore/sample-shenzhen-weekend",
      title: "深圳周末展览路线",
      rawShareText: "深圳周末展览、咖啡店和散步路线，适合半日出行",
      userNote: "周末想找轻松一点的地方"
    }
  ];

  return (
    <div className="sample-preview-block">
      <div className="section-heading-soft">
        <span><Sparkles size={18} /> 不知道填什么？试试这 3 个样例</span>
        <small>用它们可以快速看分类、行动卡和智能专辑的效果</small>
      </div>
      <div className="field-grid compact-fields">
        {samples.map((sample) => (
          <button className="field-card sample-fill-card" type="button" key={sample.title} onClick={() => props.onUseSample(sample)}>
            <span>{sample.title}</span>
            <strong>{sample.userNote}</strong>
          </button>
        ))}
      </div>
    </div>
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
  const parsedInput = parseShareInput(props.input);
  const hasOnlyFirstField = Boolean(props.input.sourceUrl.trim()) && !props.input.title.trim() && !props.input.rawShareText.trim() && !props.input.userNote.trim();
  const onlyUrlProvided = hasOnlyFirstField && Boolean(parsedInput.sourceUrl);
  const onlyShareTextProvided = hasOnlyFirstField && !parsedInput.sourceUrl;

  return (
    <form className={props.compact ? "quick-import compact" : "quick-import"} onSubmit={props.onSubmit} data-testid="quick-import-form">
      <label>
        <span>粘贴链接或分享文本</span>
        <input data-testid="import-source-url" value={props.input.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} placeholder="可以粘贴小红书链接，也可以粘贴系统分享出来的一整段文字" />
      </label>
      <label>
        <span>标题，可选</span>
        <input data-testid="import-title" value={props.input.title} onChange={(event) => update("title", event.target.value)} placeholder="可选：比如 小红书封面设计技巧" />
      </label>
      <label>
        <span>分享文案，可选</span>
        <textarea data-testid="import-raw-share-text" value={props.input.rawShareText} onChange={(event) => update("rawShareText", event.target.value)} placeholder="可选：系统分享面板带过来的可用文本" />
      </label>
      <label>
        <span>个人备注，可选</span>
        <input data-testid="import-user-note" value={props.input.userNote} onChange={(event) => update("userNote", event.target.value)} placeholder="可选：我收藏它是因为……" />
      </label>
      <button className="primary-button" type="submit" disabled={props.isLoading} data-testid="import-submit">
        {props.isLoading ? <span className="loading-dot" aria-hidden="true" /> : <Import size={17} />}
        {props.isLoading ? "正在把收藏变成行动卡..." : "生成行动卡"}
      </button>
      {onlyUrlProvided && <p className="import-hint">只有链接时系统理解会比较弱，建议补一句你为什么收藏它。</p>}
      {onlyShareTextProvided && <p className="import-hint">已识别为分享文本，没有原帖链接也可以先整理；补一句收藏原因会更准。</p>}
      <p className="import-hint">第一版用模拟分享导入，后续会接入手机系统分享入口。</p>
    </form>
  );
}

function DashboardSearchResults(props: {
  query: string;
  results: SearchResult[];
  openSource: (item: SavedItem, origin?: OpenSourceOrigin) => void;
  viewActionCard: (itemId: string) => void;
  reviveSavedItem: (itemId: string) => void;
  viewAllSearchResults: (query: string) => void;
}) {
  if (!props.query) return null;
  return (
    <section className="dashboard-search-results" data-testid="dashboard-search-results">
      <div className="section-heading-soft">
        <span><Search size={18} /> “{props.query}” 的收藏</span>
        <button className="ghost-action" onClick={() => props.viewAllSearchResults(props.query)} data-testid="dashboard-view-all-search">查看全部搜索结果</button>
      </div>
      <div className="compact-list">
        {props.results.map((result) => (
          <article className="dashboard-search-row" key={result.item.id} data-testid="dashboard-search-result">
            <div>
              <strong>{formatItemTitle(result.item)}</strong>
              <small>{formatCategoryLabel(result.item)} · 用途：{result.item.savedIntent}</small>
              <span>{result.matchReasons[0] || formatItemSummary(result.item)}</span>
            </div>
            <div className="row-actions">
              {hasSourceUrl(result.item) ? <button onClick={() => props.openSource(result.item)}>打开原帖</button> : <button disabled>暂无原帖</button>}
              <button onClick={() => props.viewActionCard(result.item.id)}>查看收藏</button>
              <button className="primary-button" onClick={() => props.reviveSavedItem(result.item.id)}>复活这条</button>
            </div>
          </article>
        ))}
        {props.results.length === 0 && <EmptyState title="没有搜到这条收藏" text="换个更模糊的词试试，或者先从导入中心补一条收藏。" />}
      </div>
    </section>
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
          <span>{formatCategoryLabel(item)}</span>
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
        {hasSourceUrl(item) ? (
          <button className="ghost-action icon-only" onClick={() => props.openSource(item)} aria-label="打开原帖" data-testid="open-source">
            <ExternalLink size={16} />
          </button>
        ) : (
          <button className="ghost-action icon-only" disabled aria-label="暂无原帖链接" data-testid="open-source-unavailable">
            <ExternalLink size={16} />
          </button>
        )}
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
        <span>{formatCategoryLabel(props.item)}</span>
        <span>{formatDate(props.item.createdAt)}</span>
      </div>
      <h3>{formatItemTitle(props.item)}</h3>
      <p>{formatItemSummary(props.item)}</p>
      <div className="tag-list">
        {props.item.keywords.slice(0, 5).map((keyword) => <span key={keyword}>{keyword}</span>)}
        <span>{props.actionCard ? "已有行动卡" : "尚未复活"}</span>
      </div>
      <div className="card-actions">
        {hasSourceUrl(props.item) ? (
          <button onClick={() => props.openSource(props.item)} data-testid="open-source">
            <ExternalLink size={16} />
            打开原帖
          </button>
        ) : (
          <button disabled data-testid="open-source-unavailable">
            <ExternalLink size={16} />
            暂无原帖链接
          </button>
        )}
        <button className="primary-button" onClick={() => props.viewActionCard(props.item.id)} data-testid="view-action-card">
          <Play size={16} />
          {props.actionCard ? "查看卡片" : "复活这条"}
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
          <span>{formatCategoryLabel(item)}</span>
          <span>{formatDate(item.createdAt)}</span>
          <span>{DISPLAY_STATUS_LABELS[item.status]}</span>
        </div>
        <h3>{formatItemTitle(item)}</h3>
        <p>{formatItemSummary(item)}</p>
        <div className="reason-list">
          {matchReasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
        {actionCard && <small>{isCompleted ? "这条收藏已经被你真正用过了。" : actionCard.nextAction}</small>}
      </div>
      <div className="row-actions search-card-actions">
        {hasSourceUrl(item) ? (
          <button className="secondary-action" onClick={() => props.openSource(item, "search")} data-testid="open-source-search">
            <ExternalLink size={16} />
            打开原帖
          </button>
        ) : (
          <button className="secondary-action" disabled data-testid="open-source-unavailable">
            <ExternalLink size={16} />
            暂无原帖链接
          </button>
        )}
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
    if ((payload?.source !== "browser-extension-poc" && payload?.source !== "browser-extension-beta") || !Array.isArray(payload.items)) return null;
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

function annotateScanDuplicateStats(result: ProcessImportBatchResult, rawCount: number, scanDuplicateCount: number): ProcessImportBatchResult {
  if (scanDuplicateCount <= 0) return result;
  const duplicateCount = result.batch.duplicateCount + scanDuplicateCount;
  return {
    ...result,
    batch: {
      ...result.batch,
      rawCount: Math.max(result.batch.rawCount, rawCount),
      duplicateCount,
      status: result.batch.importedCount > 0 ? "partially_completed" : result.batch.status
    }
  };
}

function mergeSmartAlbums(existingAlbums: SmartAlbum[], generatedAlbums: SmartAlbum[]): SmartAlbum[] {
  const generatedById = new Map(generatedAlbums.map((album) => [album.id, album]));
  const merged = generatedAlbums.map((album) => {
    const existing = existingAlbums.find((entry) => entry.id === album.id);
    if (!existing) return album;
    return mergeAlbumRecord(existing, album);
  });

  existingAlbums
    .filter((album) => album.status === "archived" && !generatedById.has(album.id))
    .forEach((album) => merged.push(album));

  return merged.sort((a, b) => b.priorityScore - a.priorityScore || b.savedItemIds.length - a.savedItemIds.length);
}
function mergeGeneratedSmartAlbums(existingAlbums: SmartAlbum[], savedItems: SavedItem[]): SmartAlbum[] {
  const existingById = new Map(existingAlbums.map((album) => [album.id, album]));
  const generated = generateSmartAlbums(savedItems);
  const merged = generated.map((album) => {
    const existing = existingById.get(album.id);
    if (!existing) return album;
    return mergeAlbumRecord(existing, album);
  });

  existingAlbums
    .filter((album) => album.status === "archived" && !merged.some((entry) => entry.id === album.id))
    .forEach((album) => merged.push(album));

  return merged.sort((a, b) => b.priorityScore - a.priorityScore || b.savedItemIds.length - a.savedItemIds.length);
}

function mergeAlbumRecord(existing: SmartAlbum, generated: SmartAlbum): SmartAlbum {
  const isLocked = existing.status === "confirmed" || existing.status === "archived";
  const manuallyAdded = existing.manuallyAddedItemIds ?? [];
  const manuallyRemoved = new Set(existing.manuallyRemovedItemIds ?? []);
  const savedItemIds = isLocked
    ? Array.from(new Set([...existing.savedItemIds, ...manuallyAdded])).filter((id) => !manuallyRemoved.has(id))
    : generated.savedItemIds.filter((id) => !manuallyRemoved.has(id));
  return {
    ...generated,
    title: existing.title,
    description: existing.description || generated.description,
    status: existing.status,
    confirmedAt: existing.confirmedAt,
    archivedAt: existing.archivedAt,
    autoCollectEnabled: existing.autoCollectEnabled ?? generated.autoCollectEnabled,
    mediumMatchRequiresApproval: existing.mediumMatchRequiresApproval ?? generated.mediumMatchRequiresApproval,
    matchProfile: existing.matchProfile ?? generated.matchProfile,
    suggestedItemIds: existing.suggestedItemIds ?? generated.suggestedItemIds ?? [],
    manuallyAddedItemIds: manuallyAdded,
    manuallyRemovedItemIds: [...manuallyRemoved],
    lastMatchedAt: existing.lastMatchedAt,
    schemaVersion: existing.schemaVersion ?? generated.schemaVersion,
    savedItemIds,
    recommendedItemIds: (isLocked ? existing.recommendedItemIds : generated.recommendedItemIds).filter((id) => savedItemIds.includes(id)).slice(0, 3),
    createdAt: existing.createdAt,
    updatedAt: generated.updatedAt
  };
}

function applyConfirmedAlbumMatching(albums: SmartAlbum[], newItems: SavedItem[]): SmartAlbum[] {
  if (newItems.length === 0) return albums;
  const now = new Date().toISOString();
  return albums.map((album) => {
    if (album.status !== "confirmed" || !album.autoCollectEnabled) return album;
    const savedSet = new Set(album.savedItemIds);
    const suggestedSet = new Set(album.suggestedItemIds ?? []);
    const removedSet = new Set(album.manuallyRemovedItemIds ?? []);
    let changed = false;
    newItems.forEach((item) => {
      if (savedSet.has(item.id) || suggestedSet.has(item.id) || removedSet.has(item.id)) return;
      const score = scoreAlbumMatch(album, item);
      if (score >= SMART_ALBUM_MATCH_THRESHOLDS.high) {
        savedSet.add(item.id);
        changed = true;
      } else if (score >= SMART_ALBUM_MATCH_THRESHOLDS.medium && album.mediumMatchRequiresApproval !== false) {
        suggestedSet.add(item.id);
        changed = true;
      }
    });
    if (!changed) return album;
    const savedItemIds = [...savedSet];
    return {
      ...album,
      savedItemIds,
      suggestedItemIds: [...suggestedSet].filter((id) => !savedSet.has(id)),
      recommendedItemIds: album.recommendedItemIds.filter((id) => savedSet.has(id)).slice(0, 3),
      lastMatchedAt: now,
      updatedAt: now
    };
  });
}

function scoreAlbumMatch(album: SmartAlbum, item: SavedItem): number {
  const profile = album.matchProfile;
  if (!profile) return 0;
  let score = 0;
  if (profile.contentDomain && profile.contentDomain === item.contentDomain) score += 38;
  if (profile.contentSubDomain && profile.contentSubDomain === item.contentSubDomain) score += 26;
  if (profile.savedIntent && profile.savedIntent === item.savedIntent) score += 30;
  const itemKeywords = new Set([item.contentSubDomain, item.savedIntent, ...item.keywords, ...item.entities.map((entity) => entity.value)].filter(Boolean));
  const keywordHits = profile.keywords.filter((keyword) => itemKeywords.has(keyword)).length;
  score += Math.min(24, keywordHits * 8);
  const entityHits = profile.entityValues.filter((value) => itemKeywords.has(value)).length;
  score += Math.min(12, entityHits * 6);
  return score;
}

function buildAlbumMatchProfile(album: SmartAlbum, savedItems: SavedItem[]): NonNullable<SmartAlbum["matchProfile"]> {
  const albumItems = album.savedItemIds
    .map((id) => savedItems.find((item) => item.id === id))
    .filter((item): item is SavedItem => Boolean(item));
  const keywords = new Set<string>(album.keywords);
  const entityValues = new Set<string>();
  albumItems.forEach((item) => {
    [item.contentSubDomain, item.savedIntent, ...item.keywords].filter(Boolean).forEach((value) => keywords.add(value));
    item.entities.forEach((entity) => entityValues.add(entity.value));
  });
  return {
    contentDomain: album.albumView === "content_domain" ? album.contentDomain : undefined,
    contentSubDomain: album.albumView === "content_domain" ? album.contentSubDomain : undefined,
    savedIntent: album.albumView === "saved_intent" ? album.savedIntent : undefined,
    keywords: [...keywords].slice(0, 12),
    entityValues: [...entityValues].slice(0, 12),
    positiveExamples: album.savedItemIds.slice(0, 6),
    negativeExamples: album.matchProfile?.negativeExamples ?? []
  };
}
function getInitialView(): ViewKey {
  if (typeof window === "undefined") return "welcome";
  const firstSegment = window.location.pathname.replace(/^\//, "").split("/")[0];
  const view = firstSegment as ViewKey;
  const supported: ViewKey[] = ["welcome", "dashboard", "import", "old-import", "search", "pool", "detail", "plans", "albums", "insights", "mobile", "settings", "real-test", "qa"];
  return supported.includes(view) ? view : "welcome";
}

function getInitialSettingsSubRoute(): SettingsSubRoute {
  if (typeof window === "undefined") return "root";
  return /^\/settings\/data-migration\/?$/.test(window.location.pathname) ? "data-migration" : "root";
}

function getInitialAlbumId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const match = window.location.pathname.match(/^\/albums\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function getInitialSearchQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

function detectDeveloperMode(): boolean {
  if (typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  if (query.get("dev") === "0") {
    window.localStorage.setItem("developerMode", "false");
    return false;
  }
  if (query.get("dev") === "1") {
    window.localStorage.setItem("developerMode", "true");
    return true;
  }
  const stored = window.localStorage.getItem("developerMode");
  if (stored === "true") return true;
  if (stored === "false") return false;
  return import.meta.env.DEV;
}

function createHandshakeRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `handshake_${uuid}` : `handshake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function detectBrowserName(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function readExtensionDomSignal(): { version?: string; protocolVersion?: string; browser?: string } | undefined {
  if (typeof document === "undefined") return undefined;
  const dataset = document.documentElement.dataset;
  if (dataset.collectionRevivalExtensionInstalled !== "true") return undefined;
  return {
    version: dataset.collectionRevivalExtensionVersion,
    protocolVersion: dataset.collectionRevivalExtensionProtocolVersion,
    browser: dataset.collectionRevivalExtensionBrowser
  };
}

function normalizeImportInput(input: ShareInput): ShareInput {
  return parseShareInput(input);
}

function normalizeDisplayCategory(item: Pick<SavedItem, "category" | "subCategory" | "classificationConfidence"> & Partial<Pick<SavedItem, "contentDomain" | "contentSubDomain" | "confidence">>): { category: Category; subCategory: string; confidence?: string } {
  const category = (item.contentDomain || item.category as string) === "其他" ? "暂存" : item.contentDomain || item.category;
  const safeCategory = (CATEGORIES as readonly string[]).includes(category) ? category as Category : "暂存";
  const subCategory = item.contentSubDomain || (item.subCategory && item.subCategory !== "其他" ? item.subCategory : safeCategory === "暂存" ? "待补充备注" : "主题整理");
  return { category: safeCategory, subCategory, confidence: item.confidence ?? item.classificationConfidence };
}

function rebuildItemSearchableText(item: Partial<SavedItem> & Pick<SavedItem, "sourceUrl" | "rawShareText" | "title" | "userNote">): string {
  return [
    item.sourceUrl,
    item.rawShareText,
    item.title,
    item.userNote,
    item.contentDomain,
    item.contentSubDomain,
    item.savedIntent,
    item.secondaryIntents?.join(" "),
    item.summary,
    item.keywords?.join(" "),
    item.entities?.map((entity) => `${entity.type}:${entity.value}`).join(" "),
    item.whyThisDomain,
    item.whyThisIntent
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function createLocalId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}_${uuid}` : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parsePlanDate(value: string, now: Date): Date {
  const text = value.trim();
  const date = new Date(now);
  date.setHours(9, 0, 0, 0);
  if (/明天/.test(text)) {
    date.setDate(date.getDate() + 1);
    return date;
  }
  if (/本周/.test(text)) {
    date.setDate(date.getDate() + Math.max(1, 5 - date.getDay()));
    return date;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return date;
}

function formatDateInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function parseEstimatedMinutes(value: string): number {
  const match = value.match(/\d+/);
  return clampEstimatedMinutes(match ? Number(match[0]) : 20);
}

function clampEstimatedMinutes(value: number): number {
  if (!Number.isFinite(value)) return 20;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 30) return 30;
  return 60;
}

function isSameDate(value: string, date: Date): boolean {
  const parsed = new Date(value);
  return parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth() && parsed.getDate() === date.getDate();
}

function formatCategoryLabel(item: Pick<SavedItem, "category" | "subCategory" | "classificationConfidence"> & Partial<Pick<SavedItem, "contentDomain" | "contentSubDomain" | "confidence">>): string {
  const { category, subCategory, confidence } = normalizeDisplayCategory(item);
  return category + " / " + subCategory + (confidence === "low" ? " · 低置信" : "");
}

function formatItemTitle(item: Pick<SavedItem, "title" | "rawShareText"> & Partial<Pick<SavedItem, "displayTitle" | "userEditedTitle" | "cleanedTitle" | "rawTitle">>): string {
  const rawTitle = item.userEditedTitle || item.displayTitle || item.cleanedTitle || item.title || item.rawTitle || "";
  const title = rawTitle.replace(/其他行动卡行动卡|行动卡行动卡|其他行动卡/g, "").trim();
  if (title) return title;
  const fallback = item.rawShareText.replace(/https?:\/\/\S+/g, "").trim().slice(0, 20);
  return fallback || "待整理收藏";
}

function formatItemSummary(item: Pick<SavedItem, "summary" | "category">): string {
  if ((item.category as string) === "其他" || /可能和.*http|其他行动卡|行动卡行动卡/.test(item.summary)) {
    return "信息还不够完整，补充一句收藏原因后可以重新整理。";
  }
  return item.summary || "信息还不够完整，补充一句收藏原因后可以重新整理。";
}

function albumStatusLabel(album: Pick<SmartAlbum, "status">): string {
  if (album.status === "confirmed") return "已确认";
  if (album.status === "archived") return "已归档";
  return "待确认";
}

function formatAlbumMatchProfile(album: SmartAlbum): string {
  const profile = album.matchProfile;
  const parts = [
    profile?.contentDomain,
    profile?.contentSubDomain,
    profile?.savedIntent,
    ...(profile?.keywords ?? []).slice(0, 3)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : album.keywords.slice(0, 4).join(" / ") || "按主题、用途和关键词匹配";
}

function hasSourceUrl(item: Pick<SavedItem, "sourceUrl">): boolean {
  return Boolean(item.sourceUrl.trim());
}

function mapReviveIntentToSavedIntent(reviveIntent: ReviveIntent | undefined, fallback: SavedIntent): SavedIntent {
  if (!reviveIntent) return fallback;
  const map: Record<ReviveIntent, SavedIntent> = {
    学会这个方法: "想学习",
    照着做一次: "想复现",
    用在工作里: "工作决策参考",
    变成自己的内容: "内容创作参考",
    安排一次出行: "想去",
    做购买决定: "想买",
    写一条观察或复盘: "情绪共鸣",
    只是整理留存: "以后查阅"
  };
  return map[reviveIntent] ?? fallback;
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatFieldValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(" / ") : value;
}

function confidenceLabel(value: SavedItem["classificationConfidence"]): string {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return "未标注";
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
