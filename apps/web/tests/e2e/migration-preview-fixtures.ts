import type { Page } from "@playwright/test";
import { ACHIEVEMENT_STORAGE_KEY, STORAGE_KEY } from "./helpers";

export const THEME_STORAGE_KEY = "collection-revival-theme";

const NOW = "2026-07-16T08:00:00.000Z";

export function makeMigrationAppState(options: { duplicateSource?: boolean } = {}) {
  const savedItem = {
    id: "saved-migration-001",
    userId: "user-migration-test",
    sourcePlatform: "xiaohongshu",
    sourceUrl: "https://www.xiaohongshu.com/explore/migration-test?xsec_token=private-test-token",
    rawShareText: "AI 工具日常工作流入门",
    rawTitle: "AI 工具日常工作流入门",
    cleanedTitle: "AI 工具日常工作流入门",
    displayTitle: "AI 工具日常工作流入门",
    textNormalizationVersion: 3,
    title: "AI 工具日常工作流入门",
    userNote: "PRIVATE_NOTE_SHOULD_NOT_RENDER",
    contentDomain: "AI 与效率",
    contentSubDomain: "AI工具",
    savedIntent: "想学习",
    secondaryIntents: [],
    confidence: "high",
    whyThisDomain: "标题明确提到 AI 工具。",
    whyThisIntent: "备注表达了学习意图。",
    category: "AI 与效率",
    subCategory: "AI工具",
    classificationConfidence: "high",
    intent: "学习 AI 工作流",
    whyThisCategory: "命中 AI 工具关键词。",
    summary: "一条测试收藏。",
    keywords: ["AI", "工作流"],
    entities: [{ type: "tool", value: "Codex" }],
    searchableText: "AI 工具 工作流 Codex",
    status: "not_started",
    createdAt: NOW,
    updatedAt: NOW
  };
  const savedItems = options.duplicateSource
    ? [savedItem, { ...savedItem, id: "saved-migration-002", title: "重复来源测试", displayTitle: "重复来源测试" }]
    : [savedItem];

  return {
    schemaVersion: 3,
    user: {
      id: "user-migration-test",
      name: "迁移测试用户",
      email: "migration@example.test",
      createdAt: NOW
    },
    savedItems,
    importBatches: [{
      id: "batch-migration-001",
      source: "extension_scan",
      title: "旧收藏扫描批次",
      status: "completed",
      rawCount: 1,
      importedCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      createdActionCardCount: 0,
      createdAlbumCount: 0,
      createdAt: NOW,
      updatedAt: NOW
    }],
    importBatchItems: [{
      id: "batch-item-migration-001",
      batchId: "batch-migration-001",
      sourceUrl: savedItem.sourceUrl,
      title: savedItem.title,
      rawTitle: savedItem.rawTitle,
      cleanedTitle: savedItem.cleanedTitle,
      displayTitle: savedItem.displayTitle,
      textNormalizationVersion: 3,
      rawShareText: savedItem.rawShareText,
      userNote: "",
      status: "imported",
      createdSavedItemId: savedItem.id,
      createdAt: NOW
    }],
    smartAlbums: [{
      id: "album-migration-001",
      title: "AI 工作流",
      description: "AI 工具相关收藏。",
      albumView: "content_domain",
      contentDomain: "AI 与效率",
      contentSubDomain: "AI工具",
      category: "AI 与效率",
      albumType: "topic",
      keywords: ["AI", "工作流"],
      savedItemIds: [savedItem.id],
      recommendedItemIds: [savedItem.id],
      suggestedItemIds: [],
      manuallyAddedItemIds: [savedItem.id],
      manuallyRemovedItemIds: [],
      whyThisAlbum: "这些收藏都和 AI 工作流有关。",
      whyStartHere: "先从最短的一条开始。",
      suggestedFirstAction: "查看第一个步骤。",
      priority: "medium",
      priorityScore: 60,
      status: "confirmed",
      confirmedAt: NOW,
      autoCollectEnabled: true,
      mediumMatchRequiresApproval: true,
      createdAt: NOW,
      updatedAt: NOW
    }],
    actionCards: [{
      id: "action-migration-001",
      savedItemId: savedItem.id,
      category: "AI 与效率",
      subCategory: "AI工具",
      title: "复现一个 AI 工作流步骤",
      goal: "复现第一个方法。",
      whySaved: "想把方法用到自己的项目。",
      nextAction: "打开原帖，记录第一个步骤并执行一次。",
      openOriginalFocus: ["工具名称", "第一个步骤"],
      output: "一张操作截图",
      estimatedTime: "20分钟",
      difficulty: "低",
      doneCriteria: "得到一张操作截图。",
      avoidDoing: "不一次整理全部方法。",
      ifInfoMissing: "补充原帖信息。",
      followUp: "再试第二个方法。",
      fields: { focus: ["工具名称", "第一个步骤"] },
      tasks: [],
      createdAt: NOW,
      updatedAt: NOW
    }],
    planCards: [{
      id: "plan-migration-001",
      savedItemId: savedItem.id,
      actionCardId: "action-migration-001",
      title: "复现 AI 工作流",
      sourceTitle: savedItem.title,
      plannedDate: "2026-07-16",
      estimatedMinutes: 20,
      oneNextStep: "复现第一个步骤。",
      doneCriteria: "得到截图。",
      status: "planned",
      reminderEnabled: false,
      createdAt: NOW,
      updatedAt: NOW
    }],
    classificationCorrections: [{
      id: "correction-migration-001",
      savedItemId: savedItem.id,
      previousDomain: "暂存",
      previousSubDomain: "待补充备注",
      previousIntent: "暂时保存",
      correctedDomain: "AI 与效率",
      correctedSubDomain: "AI工具",
      correctedIntent: "想学习",
      tags: ["AI"],
      textSnapshot: "AI 工具日常工作流入门",
      createdAt: NOW
    }],
    searchLogs: [{
      id: "search-migration-001",
      userId: "user-migration-test",
      query: "AI",
      resultCount: 1,
      clickedSavedItemId: savedItem.id,
      createdAt: NOW
    }]
  };
}

export async function seedMigrationFixture(page: Page, options: { duplicateSource?: boolean } = {}) {
  const state = makeMigrationAppState(options);
  await page.addInitScript(({ state, storageKey, achievementKey, themeKey }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    window.localStorage.setItem(achievementKey, JSON.stringify({ first_revival: "2026-07-16T08:00:00.000Z" }));
    window.localStorage.setItem(themeKey, "lavender-mint");
  }, { state, storageKey: STORAGE_KEY, achievementKey: ACHIEVEMENT_STORAGE_KEY, themeKey: THEME_STORAGE_KEY });
}

export async function installTask7aBoundarySpies(page: Page) {
  await page.evaluate(() => {
    const boundary = {
      setItemCalls: 0,
      removeItemCalls: 0,
      clearCalls: 0,
      indexedDbOpenCalls: 0
    };
    Object.defineProperty(window, "__task7aBoundary", { value: boundary, configurable: true });

    const storagePrototype = Storage.prototype;
    const originalSetItem = storagePrototype.setItem;
    const originalRemoveItem = storagePrototype.removeItem;
    const originalClear = storagePrototype.clear;
    storagePrototype.setItem = function (...args) {
      boundary.setItemCalls += 1;
      return originalSetItem.apply(this, args as [string, string]);
    };
    storagePrototype.removeItem = function (...args) {
      boundary.removeItemCalls += 1;
      return originalRemoveItem.apply(this, args as [string]);
    };
    storagePrototype.clear = function () {
      boundary.clearCalls += 1;
      return originalClear.call(this);
    };

    const factory = window.indexedDB;
    const originalOpen = factory.open.bind(factory);
    Object.defineProperty(factory, "open", {
      configurable: true,
      value: (...args: Parameters<IDBFactory["open"]>) => {
        boundary.indexedDbOpenCalls += 1;
        return originalOpen(...args);
      }
    });
  });
}

export async function readTask7aBoundarySpies(page: Page) {
  return page.evaluate(() => (window as Window & {
    __task7aBoundary: {
      setItemCalls: number;
      removeItemCalls: number;
      clearCalls: number;
      indexedDbOpenCalls: number;
    };
  }).__task7aBoundary);
}

export async function readLocalStorageSnapshot(page: Page) {
  return page.evaluate(() => {
    const output: Record<string, string | null> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) output[key] = window.localStorage.getItem(key);
    }
    return output;
  });
}

declare global {
  interface Window {
    __task7aBoundary?: {
      setItemCalls: number;
      removeItemCalls: number;
      clearCalls: number;
      indexedDbOpenCalls: number;
    };
  }
}
