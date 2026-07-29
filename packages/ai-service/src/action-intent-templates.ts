import type { ActionCardDraft, ActionIntentKey, TaskDraft } from "@revival/shared-types";

export const ACTION_INTENT_TEMPLATE_VERSION = "action-intent-v1";

type IntentTemplateContext = {
  intent: ActionIntentKey;
  title: string;
  summary: string;
  contentTheme: string;
  contentSubDomain: string;
};

export function buildActionCardForIntent(context: IntentTemplateContext): ActionCardDraft {
  const topic = normalizeTopic(context.title || context.summary || context.contentSubDomain || context.contentTheme);
  const common = {
    generatedFromIntent: context.intent,
    templateVersion: ACTION_INTENT_TEMPLATE_VERSION
  } as const;
  const make = (
    suffix: string,
    goal: string,
    nextAction: string,
    output: string,
    doneCriteria: string,
    tasks: TaskDraft[],
    fields: Record<string, string | string[]>
  ): ActionCardDraft => ({
    ...common,
    title: `${topic} · ${suffix}`,
    goal,
    whySaved: `这张行动卡按你选择的用途“${intentLabel(context.intent)}”生成。`,
    nextAction,
    openOriginalFocus: ["使用的工具或材料", "关键步骤与顺序", "作者展示的结果", "容易卡住的细节"],
    output,
    estimatedTime: context.intent === "learn_method" ? "30分钟" : "20分钟",
    difficulty: "低",
    doneCriteria,
    avoidDoing: "只完成这次最小行动，不扩展成大型整理或长期项目。",
    ifInfoMissing: "若原帖信息不足，先补充工具、步骤或关键条件，再开始执行。",
    followUp: "保存本次结果和卡点，下次从已验证的步骤继续。",
    tasks,
    structuredFields: {
      内容主题: context.contentTheme,
      二级主题: context.contentSubDomain,
      选定用途: intentLabel(context.intent),
      ...fields,
      产出物: output,
      完成标准: doneCriteria
    }
  });

  switch (context.intent) {
    case "learn_method":
      return make(
        "最小方法复现",
        `按原方法完成一次最小复现，围绕“${topic}”做出 1 张测试图文。`,
        "打开原帖，先记下工具、提示词和关键步骤；再选一个熟悉主题完成一张测试图。",
        "1 张测试图文 + 1 份 3-5 步操作清单",
        "测试图已经导出，操作清单能让你下次不看原帖也能再做一次。",
        [
          task("记录原方法", "记下工具、提示词和关键步骤，不整理标题或选题套路。", "8分钟"),
          task("完成测试图", "选一个熟悉主题，按原方法完成并导出 1 张测试图。", "15分钟"),
          task("保存可复用清单", "记录成功步骤、卡点和可复用提示词，整理成 3-5 步。", "7分钟")
        ],
        { 学习目标: "完成一次最小方法复现", 操作清单: ["工具与提示词", "关键步骤", "成功步骤与卡点"] }
      );
    case "copy_once":
      return make(
        "照着做一次",
        `照着原帖把“${topic}”完整复现一次，先验证方法是否可行。`,
        "准备原帖要求的工具或材料，按顺序完成一次最小复现并保存结果。",
        "1 个可查看的复现结果 + 1 条卡点记录",
        "已经完成一次可查看的复现，并记下成功或失败的关键原因。",
        [task("准备条件", "确认工具、材料和入口。", "5分钟"), task("照着复现", "按原顺序完成一次。", "10分钟"), task("记录卡点", "保存结果并写下一个卡点。", "5分钟")],
        { 复现条件: ["工具或材料", "操作顺序", "结果证据"] }
      );
    case "use_at_work":
      return make(
        "工作场景试用",
        `把“${topic}”用于一个真实工作场景，产出可交付的草稿或模板。`,
        "选一个本周真实任务，套用原方法完成第一版工作草稿。",
        "1 份可用于工作的草稿、SOP 或模板",
        "产出已经对应一个真实工作任务，并能交给同事查看或继续编辑。",
        [task("绑定工作任务", "写下使用者、场景和截止时间。", "5分钟"), task("完成第一版", "按方法做出草稿或模板。", "10分钟"), task("检查可用性", "确认下一位使用者知道如何继续。", "5分钟")],
        { 工作场景: ["使用者", "真实任务", "截止时间"], 交付形式: "草稿 / SOP / 模板" }
      );
    case "make_own_content":
      return make(
        "内容转化",
        `把“${topic}”转成适合自己账号的一条内容选题和表达结构。`,
        "提取标题、封面和开头结构，再结合自己的账号方向改写一个选题。",
        "1 条可发布选题 + 1 个封面或开头结构草稿",
        "选题已改写成自己的账号语境，并标明借鉴的是结构而非原文。",
        [task("拆解结构", "记录标题、封面和开头钩子的结构。", "7分钟"), task("改写选题", "结合账号方向改写一条选题。", "8分钟"), task("保存草稿", "保存封面或开头结构草稿。", "5分钟")],
        { 内容结构: ["标题", "封面", "开头钩子"], 账号转化: "只借鉴结构，不复制原文" }
      );
    case "plan_trip":
      return make(
        "出行计划",
        `把“${topic}”整理成一次可决定、可执行的出行安排。`,
        "确认候选日期、路线、预算和预约条件，形成一份出行草案。",
        "1 份含日期、路线、预算和候选项的出行草案",
        "日期、到达路线、预算和是否预约均已明确。",
        [task("确认时间", "选择一个真实候选日期。", "5分钟"), task("整理路线", "确认地点、交通和开放时间。", "10分钟"), task("核对预算", "记录预算、预约和一个备选。", "5分钟")],
        { 出行要素: ["日期", "路线", "预算", "预约", "备选"] }
      );
    case "make_purchase_decision":
      return make(
        "购买决策",
        `围绕“${topic}”完成一次购买比较并给出明确选择。`,
        "列出需求、预算和候选方案，完成对比后写下买、等或不买的结论。",
        "1 张候选对比表 + 1 个最终选择",
        "比较维度和预算清楚，并已写下买、等或不买及理由。",
        [task("写清需求", "记录必须满足的条件和预算。", "5分钟"), task("完成对比", "比较最多三个候选。", "10分钟"), task("做出选择", "写下买、等或不买及理由。", "5分钟")],
        { 决策维度: ["需求", "预算", "候选对比", "最终选择"] }
      );
    case "reflect":
      return make(
        "观察与复盘",
        `把“${topic}”转成一次联系现实场景的观察和小行动。`,
        "摘出一个共鸣点，写下它对应的真实场景，再确定一个小行动。",
        "1 条共鸣点 + 1 个现实场景 + 1 个小行动",
        "观察已落到自己的真实场景，并写下一个可执行的小行动。",
        [task("摘出共鸣点", "用自己的话写下一个观点。", "5分钟"), task("联系现实", "记录最近发生的一个对应场景。", "10分钟"), task("决定小行动", "写下下一次要尝试的动作。", "5分钟")],
        { 复盘结构: ["共鸣点", "现实场景", "小行动"] }
      );
    case "organize_only":
      return make("索引留存", `只整理“${topic}”的索引，不创建执行任务。`, "补充一个便于以后搜索的关键词。", "1 条可搜索索引", "标题、主题和用途索引已保存。", [], { 整理方式: "仅索引留存" });
  }
}

function task(title: string, description: string, estimatedTime: string): TaskDraft {
  return { title, description, estimatedTime };
}

function normalizeTopic(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 42) || "这条收藏";
}

function intentLabel(intent: ActionIntentKey): string {
  return {
    learn_method: "学会这个方法",
    copy_once: "照着做一次",
    use_at_work: "用在工作里",
    make_own_content: "变成自己的内容",
    plan_trip: "安排一次出行",
    make_purchase_decision: "做购买决定",
    reflect: "写观察或复盘",
    organize_only: "只是整理留存"
  }[intent];
}