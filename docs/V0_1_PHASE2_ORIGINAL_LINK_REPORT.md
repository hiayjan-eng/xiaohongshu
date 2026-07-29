# V0.1 Phase 2 原帖链接报告

`V0_1_PHASE2_STATUS: READY_FOR_USER_VALIDATION`

日期：2026-07-29  
真实链接提交 Git：否  
Production 修改：否

## 结论

原帖入口已经统一使用同一个 `openSource` 函数。打开顺序为 `userCorrectedSourceUrl` → 有效 raw `sourceUrl` → `canonicalSourceUrl` 兜底；这样既保证用户修复值最高优先级，也保留原始链接中可能影响可达性的必要参数。所有入口在新标签页以 `noopener,noreferrer` 打开。

系统会保存 raw sourceUrl、canonicalSourceUrl、sourceId、sourcePlatform、sourceUrlStatus、lastUrlCheckedAt 和 userCorrectedSourceUrl。profile 页面不会被当作具体笔记；无有效链接时按钮不可用，详情页提供“修复链接”；用户标记失效后显示“原帖可能已删除、不可见或链接已失效”。重新整理本地数据显式保留原始 URL 和用户修复值。

## 自动验证

| 项目 | 结果 |
| --- | --- |
| `/explore/<noteId>` | PASS |
| `/discovery/item/<noteId>` | PASS |
| `/search_result/<noteId>` 与嵌套笔记路径 | PASS（解析实现） |
| `note_id` / `noteId` / `item_id` query | PASS（解析实现） |
| xsec_token / xsec_source 不改变 sourceId 去重 | PASS |
| profile ID 不误判 | PASS |
| canonical URL 生成 | PASS |
| raw sourceUrl 不被 canonical 覆盖 | PASS |
| userCorrectedSourceUrl 优先 | PASS |
| 修复后刷新保留 | PASS（Playwright） |
| 重新整理不覆盖修复值 | PASS（实现与类型回归） |
| 所有 Web 入口统一函数 | PASS（收藏池、专辑、搜索及详情共用回调） |

上述使用合成脱敏 URL；没有访问或提交真实用户原帖。

## 20 条真实原帖验收记录

只填写脱敏 hash 和结果，不粘贴真实链接、标题、作者、正文或 token。

| # | 脱敏 hash | 打开结果（成功/删除/不可见/错误跳转） | 失效提示 | 修复入口 | 修复后刷新保留 |
| ---: | --- | --- | --- | --- | --- |
| 01 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 02 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 03 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 04 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 05 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 06 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 07 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 08 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 09 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 10 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 11 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 12 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 13 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 14 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 15 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 16 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 17 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 18 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 19 | 待填 | 待测 | 待测 | 待测 | 待测 |
| 20 | 待填 | 待测 | 待测 | 待测 | 待测 |

## 发布门

有效链接成功率必须 ≥95%，即 20 条中至少 19 条有效链接正确到达对应原帖；删除或不可见项必须出现明确提示，至少完成一次用户修复并确认刷新保留，同时 raw sourceUrl 保持原值。当前真实分母为 0，因此状态只能是 `READY_FOR_USER_VALIDATION`。