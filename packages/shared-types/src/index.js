"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_USER = exports.STATUS_LABELS = exports.STATUSES = exports.APP_SCHEMA_VERSION = exports.REVIVE_INTENTS = exports.SAVED_INTENTS = exports.CONTENT_DOMAINS = exports.CATEGORIES = void 0;
exports.CATEGORIES = [
    "内容创作",
    "AI 与效率",
    "技能学习",
    "工作与职业",
    "商业与经营",
    "出行与探店",
    "饮食与健康",
    "生活与家居",
    "穿搭与消费",
    "情绪与关系",
    "读书与思考",
    "暂存"
];
exports.CONTENT_DOMAINS = exports.CATEGORIES;
exports.SAVED_INTENTS = [
    "想学习",
    "想复现",
    "想去",
    "想买",
    "想做",
    "内容创作参考",
    "工作决策参考",
    "求职关注",
    "创业团队参考",
    "以后联系",
    "商业案例参考",
    "情绪共鸣",
    "以后查阅",
    "暂时保存"
];
exports.REVIVE_INTENTS = [
    "学会这个方法",
    "照着做一次",
    "用在工作里",
    "变成自己的内容",
    "安排一次出行",
    "做购买决定",
    "写一条观察或复盘",
    "只是整理留存"
];
exports.APP_SCHEMA_VERSION = 3;
exports.STATUSES = [
    "not_started",
    "today",
    "in_progress",
    "completed",
    "snoozed"
];
exports.STATUS_LABELS = {
    not_started: "未开始",
    today: "已加入今日行动",
    in_progress: "进行中",
    completed: "已完成",
    snoozed: "已搁置"
};
exports.DEFAULT_USER = {
    id: "user_local_001",
    name: "本地用户",
    email: "local@revival.app",
    createdAt: "2026-07-06T00:00:00.000Z"
};
