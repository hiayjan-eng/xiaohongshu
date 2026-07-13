export const CATEGORIES = [
  "内容创作",
  "AI 与效率",
  "技能学习",
  "出行与探店",
  "饮食与健康",
  "生活与家居",
  "穿搭与消费",
  "情绪与关系",
  "读书与思考",
  "暂存"
] as const;

export type Category = (typeof CATEGORIES)[number];
export type ClassificationConfidence = "high" | "medium" | "low";
export type SmartAlbumPriority = "high" | "medium" | "low";

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
  subCategory: string;
  classificationConfidence?: ClassificationConfidence;
  intent: string;
  whyThisCategory: string;
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
  subCategory: string;
  title: string;
  goal: string;
  whySaved: string;
  nextAction: string;
  openOriginalFocus: string[];
  output: string;
  estimatedTime: string;
  difficulty: "低" | "中" | "高";
  doneCriteria: string;
  avoidDoing: string;
  ifInfoMissing: string;
  followUp: string;
  fields: Record<string, string | string[]>;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface ActionCardDraft {
  title: string;
  goal: string;
  whySaved: string;
  nextAction: string;
  openOriginalFocus: string[];
  output: string;
  estimatedTime: string;
  difficulty: "低" | "中" | "高";
  doneCriteria: string;
  avoidDoing: string;
  ifInfoMissing: string;
  followUp: string;
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
  subCategory: string;
  confidence: ClassificationConfidence;
  intent: string;
  whyThisCategory: string;
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
  albumType: string;
  keywords: string[];
  savedItemIds: string[];
  recommendedItemIds: string[];
  coverItemId?: string;
  whyThisAlbum: string;
  whyStartHere: string;
  suggestedFirstAction: string;
  priority: SmartAlbumPriority;
  priorityScore: number;
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
  subCategory: string;
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
