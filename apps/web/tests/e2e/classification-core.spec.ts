import { expect, test } from "@playwright/test";
import { classifyCollectionInput } from "../../../../packages/classification-service/src/index";
import { classificationEvalFixtures, evaluateClassificationFixtures } from "../../../../packages/classification-service/src/eval-fixtures";

test.describe("classification service core", () => {
  test("passes the confusing Chinese classification fixtures", () => {
    const report = evaluateClassificationFixtures();
    expect(report.total).toBeGreaterThanOrEqual(60);
    expect(report.domainAccuracy).toBeGreaterThanOrEqual(85);
    expect(report.top3DomainAccuracy).toBeGreaterThanOrEqual(90);
    expect(report.highConfidenceErrorRate).toBeLessThanOrEqual(5);
    expect(report.failed重点Cases).toEqual([]);
  });

  test("keeps city hiring and commercial emotion pricing in the right domains", () => {
    const hiring = classifyCollectionInput({
      sourceUrl: "https://www.xiaohongshu.com/explore/hiring",
      title: "欢迎大家加入我的创业公司（广深优先）",
      rawShareText: "招聘、招人、岗位、团队，广深优先",
      userNote: ""
    });
    expect(hiring.contentDomain).toBe("工作与职业");
    expect(hiring.contentSubDomain).toMatch(/招聘求职|创业团队/);
    expect(hiring.savedIntent).toMatch(/求职关注|创业团队参考|以后联系/);
    expect(hiring.classificationShadow.provider).toBe("hybrid-rule-semantic-local");

    const business = classifyCollectionInput({
      sourceUrl: "https://www.xiaohongshu.com/explore/business",
      title: "拆解一个赚钱的独立站 几块串珠卖出10倍情绪溢价",
      rawShareText: "#独立站运营 #跨境选品 #产品 #客单价",
      userNote: ""
    });
    expect(business.contentDomain).toBe("商业与经营");
    expect(business.contentSubDomain).toMatch(/独立站运营|选品与定价|跨境电商/);
    expect(business.savedIntent).toBe("商业案例参考");
    expect(business.conflictingEvidence.join(" ")).toContain("情绪");

    const relationship = classifyCollectionInput({
      sourceUrl: "",
      title: "关系中如何表达需求",
      rawShareText: "亲密关系、边界感和沟通表达",
      userNote: ""
    });
    expect(relationship.contentDomain).toBe("情绪与关系");
  });

  test("contains realistic coverage for every domain", () => {
    const coveredDomains = new Set(classificationEvalFixtures.map((fixture) => fixture.expectedDomain));
    [
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
    ].forEach((domain) => expect(coveredDomains.has(domain as never)).toBeTruthy());
  });
});
