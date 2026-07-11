export const CATEGORIES = [
  "技能学习",
  "旅行地点",
  "美食探店",
  "菜谱做饭",
  "穿搭变美",
  "家居生活",
  "工作效率",
  "灵感素材",
  "其他"
] as const;

export type Category = (typeof CATEGORIES)[number];

export const STATUSES = [
  "not_started",
  "today",
  "in_progress",
  "completed",
  "snoozed"
] as const;

export type ItemStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  not_started: "未开始",
  today: "已加入今日行动",
  in_progress: "进行中",
  completed: "已完成",
  snoozed: "已搁置"
};

export type PlanType = "learning" | "travel" | "recipe" | "workflow" | "life" | "creative" | "mixed";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface EntityTag {
  type: string;
  value: string;
}

export interface Task {
  id: string;
  actionCardId: string;
  title: string;
  description: string;
  estimatedTime: string;
  dueDate?: string;
  status: ItemStatus;
  order: number;
}

export interface TaskDraft {
  title: string;
  description: string;
  estimatedTime: string;
  dueDate?: string;
}

export interface SavedItem {
  id: string;
  userId: string;
  sourcePlatform: "xiaohongshu" | "manual" | "other";
  sourceUrl: string;
  rawShareText: string;
  title: string;
  userNote: string;
  category: Category;
  intent: string;
  summary: string;
  keywords: string[];
  entities: EntityTag[];
  searchableText: string;
  embedding?: number[];
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActionCard {
  id: string;
  savedItemId: string;
  category: Category;
  title: string;
  goal: string;
  nextAction: string;
  estimatedTime: string;
  difficulty: "低" | "中" | "高";
  fields: Record<string, string | string[]>;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface ActionCardDraft {
  title: string;
  goal: string;
  nextAction: string;
  estimatedTime: string;
  difficulty: "低" | "中" | "高";
  tasks: TaskDraft[];
  structuredFields: Record<string, string | string[]>;
}

export interface Plan {
  id: string;
  userId: string;
  title: string;
  type: PlanType;
  durationDays: 3 | 7 | 30;
  description: string;
  actionCardIds: string[];
  tasks: Task[];
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DailyRevival {
  id: string;
  userId: string;
  date: string;
  actionCardIds: string[];
  reason: string;
  completedCount: number;
}

export interface SearchLog {
  id: string;
  userId: string;
  query: string;
  resultCount: number;
  clickedSavedItemId?: string;
  createdAt: string;
}

export interface ExtensionScannedItem {
  title: string;
  sourceUrl: string;
  coverUrl?: string;
  visibleText?: string;
  sourcePlatform: "xiaohongshu";
}

export interface ExtensionImportPayload {
  source: "browser-extension-poc";
  sourcePlatform: "xiaohongshu";
  scannedAt: string;
  pageUrl?: string;
  items: ExtensionScannedItem[];
}

export type ImportSource =
  | "manual_single"
  | "extension_scan"
  | "batch_links"
  | "browser_bookmarks"
  | "mobile_share"
  | "screenshot_ocr"
  | "other";

export type ImportBatchStatus = "pending" | "processing" | "completed" | "failed" | "partially_completed";
export type ImportBatchItemStatus = "pending" | "imported" | "duplicate" | "failed" | "skipped";

export interface ImportBatch {
  id: string;
  source: ImportSource;
  title: string;
  status: ImportBatchStatus;
  rawCount: number;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  createdActionCardCount: number;
  createdAlbumCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatchItem {
  id: string;
  batchId: string;
  sourceUrl: string;
  title: string;
  rawShareText: string;
  visibleText?: string;
  coverUrl?: string;
  userNote: string;
  status: ImportBatchItemStatus;
  duplicateOfSavedItemId?: string;
  errorMessage?: string;
  createdSavedItemId?: string;
  createdActionCardId?: string;
  createdAt: string;
}

export interface ShareInput {
  sourceUrl: string;
  rawShareText: string;
  title: string;
  userNote: string;
}

export interface AiClassificationResult {
  category: Category;
  intent: string;
  summary: string;
  keywords: string[];
  entities: EntityTag[];
  searchableText: string;
  actionCard: ActionCardDraft;
}

export interface SearchResult {
  item: SavedItem;
  actionCard?: ActionCard;
  score: number;
  matchReasons: string[];
}

export interface RevivalRecommendation {
  item: SavedItem;
  actionCard: ActionCard;
  score: number;
  reason: string;
}

export interface SmartAlbum {
  id: string;
  title: string;
  description: string;
  category: Category;
  keywords: string[];
  savedItemIds: string[];
  coverItemId?: string;
  priority: number;
  status: "candidate" | "confirmed" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  user: User;
  savedItems: SavedItem[];
  actionCards: ActionCard[];
  searchLogs: SearchLog[];
  smartAlbums?: SmartAlbum[];
  importBatches?: ImportBatch[];
  importBatchItems?: ImportBatchItem[];
}

export const DEFAULT_USER: User = {
  id: "user_local_001",
  name: "本地用户",
  email: "local@revival.app",
  createdAt: "2026-07-06T00:00:00.000Z"
};

export type ClassificationRating = "accurate" | "acceptable" | "wrong";
export type ActionCardRating = "useful" | "average" | "useless";
export type NextStepRating = "clear" | "unclear" | "no";
export type TodayWillingness = "willing" | "later" | "unwilling";
export type RewardRating = "satisfying" | "average" | "none";

export interface RealUserTestRecord {
  id: string;
  savedItemId: string;
  sourceUrl: string;
  title: string;
  rawShareText: string;
  userNote: string;
  category: Category;
  summary: string;
  keywords: string[];
  entities: EntityTag[];
  nextAction: string;
  classificationRating?: ClassificationRating;
  actionCardRating?: ActionCardRating;
  nextStepRating?: NextStepRating;
  todayWillingness?: TodayWillingness;
  searchQuery?: string;
  searchFound?: boolean;
  searchMatchReason?: string;
  rewardRating?: RewardRating;
  issueNote?: string;
  createdAt: string;
  updatedAt: string;
}