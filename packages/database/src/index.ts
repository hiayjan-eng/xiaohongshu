import { classifyAndGenerateActionCard } from "@revival/ai-service";
import {
  DEFAULT_USER,
  type ActionCard,
  type AiClassificationResult,
  type AppState,
  type ItemStatus,
  type SavedItem,
  type SearchLog,
  type ShareInput,
  type Task
} from "@revival/shared-types";

export const STORAGE_KEY = "collection-revival-system:v1";

export function loadAppState(storage?: Pick<Storage, "getItem" | "setItem">): AppState {
  if (!storage) return createInitialDemoData();

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = createInitialDemoData();
    storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  try {
    return normalizeAppState(JSON.parse(raw) as AppState);
  } catch {
    const initial = createInitialDemoData();
    storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
}

export function persistAppState(state: AppState, storage?: Pick<Storage, "setItem">): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createImportedRecords(
  userId: string,
  input: ShareInput,
  aiResult: AiClassificationResult,
  now = new Date()
): { savedItem: SavedItem; actionCard: ActionCard } {
  const savedItemId = createId("item");
  const actionCardId = createId("card");
  const createdAt = now.toISOString();
  const tasks = aiResult.actionCard.tasks.map<Task>((task, index) => ({
    id: `task_${actionCardId}_${index + 1}`,
    actionCardId,
    title: task.title,
    description: task.description,
    estimatedTime: task.estimatedTime,
    dueDate: task.dueDate,
    status: "not_started",
    order: index + 1
  }));

  const savedItem: SavedItem = {
    id: savedItemId,
    userId,
    sourcePlatform: detectPlatform(input.sourceUrl),
    sourceUrl: input.sourceUrl,
    rawShareText: input.rawShareText,
    title: input.title || aiResult.actionCard.title,
    userNote: input.userNote,
    category: aiResult.category,
    intent: aiResult.intent,
    summary: aiResult.summary,
    keywords: aiResult.keywords,
    entities: aiResult.entities,
    searchableText: aiResult.searchableText,
    status: "not_started",
    createdAt,
    updatedAt: createdAt
  };

  const actionCard: ActionCard = {
    id: actionCardId,
    savedItemId,
    category: aiResult.category,
    title: aiResult.actionCard.title,
    goal: aiResult.actionCard.goal,
    nextAction: aiResult.actionCard.nextAction,
    estimatedTime: aiResult.actionCard.estimatedTime,
    difficulty: aiResult.actionCard.difficulty,
    fields: aiResult.actionCard.structuredFields,
    tasks,
    createdAt,
    updatedAt: createdAt
  };

  return { savedItem, actionCard };
}

export function createSearchLog(userId: string, query: string, resultCount: number, clickedSavedItemId?: string): SearchLog {
  return {
    id: createId("search"),
    userId,
    query,
    resultCount,
    clickedSavedItemId,
    createdAt: new Date().toISOString()
  };
}

export function updateItemStatus(items: SavedItem[], id: string, status: ItemStatus): SavedItem[] {
  const updatedAt = new Date().toISOString();
  return items.map((item) => (item.id === id ? { ...item, status, updatedAt } : item));
}

export function createInitialDemoData(): AppState {
  const now = new Date();
  const records = DEMO_SEED_INPUTS.map((input, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - index);
    return createImportedRecords(DEFAULT_USER.id, input, classifyAndGenerateActionCard(input), date);
  });

  return {
    user: DEFAULT_USER,
    savedItems: records.map((record, index) => ({
      ...record.savedItem,
      status: DEMO_STATUSES[index] ?? "not_started"
    })),
    actionCards: records.map((record) => record.actionCard),
    searchLogs: []
  };
}

const DEMO_SEED_INPUTS: ShareInput[] = [
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-capcut-7days",
    title: "剪映新手 7 天剪辑入门",
    rawShareText: "手机剪辑教程，适合短视频入门，包含开头 3 秒、转场、字幕和节奏练习。",
    userNote: "做账号之前先练一条 30 秒视频"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-ai-tools-workflow",
    title: "AI工具日常工作流入门",
    rawShareText: "AI 工具教程，讲提示词、资料整理、表格总结和自动化流程，适合办公效率提升。",
    userNote: "想整理成自己的每日工作 SOP"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-english-speaking",
    title: "英语口语 14 天影子跟读练习",
    rawShareText: "英语学习方法，适合通勤练习，包含跟读、复述和每日 15 分钟训练。",
    userNote: "先从早餐后 15 分钟开始"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-writing-note",
    title: "写作练习：把生活观察写成小红书笔记",
    rawShareText: "写作教程，包含标题、开头、故事结构和练习任务，适合内容创作者入门。",
    userNote: "可以用来写产品日记"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-photography-light",
    title: "手机摄影自然光构图训练",
    rawShareText: "摄影入门课程，讲自然光、构图、人物拍摄和后期调色练习。",
    userNote: "周末拍咖啡店照片时试一下"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-dali-three-days",
    title: "大理 3 天慢旅行路线",
    rawShareText: "大理旅行攻略，包含古城、洱海、喜洲路线、交通和适合季节。",
    userNote: "下次年假可以参考"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-shenzhen-weekend",
    title: "深圳周末展览和咖啡路线",
    rawShareText: "适合周末去的深圳展览路线，附近还有咖啡店和散步点，不用请假。",
    userNote: "想找一个轻松周末安排"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-food-coffee-brunch",
    title: "广州安静咖啡店 brunch 探店",
    rawShareText: "咖啡店探店，适合下午茶、brunch、聊天和拍照，人均预算 80 左右。",
    userNote: "适合约朋友周日下午去"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-art-exhibition",
    title: "上海近期展览路线清单",
    rawShareText: "上海展览、城市散步和美术馆路线，适合周末半日游。",
    userNote: "可以和摄影练习一起安排"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-hiking-weekend",
    title: "杭州周边徒步一日路线",
    rawShareText: "周边游徒步路线，包含交通、补给、景点、预算和避坑提醒。",
    userNote: "天气好时先走轻松路线"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-recipe-lowcal-dinner",
    title: "低卡晚餐：空气炸锅鸡胸肉便当",
    rawShareText: "减脂餐菜谱，空气炸锅做饭，鸡胸肉、蔬菜、玉米和工作日晚餐备餐。",
    userNote: "下班不想再点外卖"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-life-closet-storage",
    title: "衣柜换季收纳整理法",
    rawShareText: "收纳教程，衣柜整理、分区、断舍离和换季家居生活清单。",
    userNote: "周六上午整理衣柜"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-life-rental-makeover",
    title: "租房改造低预算氛围布置",
    rawShareText: "租房改造、软装、灯光、地毯和家居布置，预算不高也能提升氛围。",
    userNote: "先买灯和收纳盒，不动硬装"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-recipe-breakfast",
    title: "10 分钟高蛋白早餐备餐",
    rawShareText: "早餐菜谱，鸡蛋、酸奶、燕麦和水果，适合工作日前一晚准备。",
    userNote: "先试三天，不追求复杂"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-life-kitchen-clean",
    title: "厨房清洁周末 30 分钟流程",
    rawShareText: "清洁 SOP，厨房油污、台面、水槽和冰箱整理，适合周末快速完成。",
    userNote: "周末先做一次最小清洁"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-cover-design",
    title: "小红书封面标题排版参考",
    rawShareText: "封面、标题、审美参考和内容结构，适合做选题库和账号运营素材。",
    userNote: "之后做产品案例封面"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-topic-bank",
    title: "30 个生活方式账号选题方向",
    rawShareText: "选题灵感，包含账号定位、系列内容、爆款标题和可复用结构。",
    userNote: "可以拆成一周内容计划"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-copywriting",
    title: "种草文案开头 20 个模板",
    rawShareText: "文案素材，包含标题、开头、转折和行动号召，适合写小红书笔记。",
    userNote: "写工具推荐时可以参考"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-shooting-angle",
    title: "手机拍摄角度和运镜灵感",
    rawShareText: "拍摄灵感、脚本、构图、俯拍和近景参考，适合探店和做饭视频。",
    userNote: "下次拍早餐或咖啡店试试"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-account-operation",
    title: "小红书账号运营复盘模板",
    rawShareText: "账号运营、内容结构、数据复盘、选题和封面优化，适合每周复盘。",
    userNote: "周日晚上用来整理账号"
  }
];

const DEMO_STATUSES: ItemStatus[] = [
  "today",
  "in_progress",
  "not_started",
  "not_started",
  "snoozed",
  "not_started",
  "today",
  "not_started",
  "not_started",
  "snoozed",
  "today",
  "not_started",
  "in_progress",
  "not_started",
  "not_started",
  "not_started",
  "today",
  "not_started",
  "in_progress",
  "not_started"
];
function detectPlatform(sourceUrl: string): SavedItem["sourcePlatform"] {
  if (/xiaohongshu\.com|xhslink\.com/i.test(sourceUrl)) return "xiaohongshu";
  if (!sourceUrl) return "manual";
  return "other";
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}


function normalizeAppState(state: AppState): AppState {
  return {
    ...state,
    savedItems: state.savedItems ?? [],
    actionCards: state.actionCards ?? [],
    searchLogs: state.searchLogs ?? [],
    smartAlbums: state.smartAlbums ?? [],
    importBatches: state.importBatches ?? [],
    importBatchItems: state.importBatchItems ?? []
  };
}