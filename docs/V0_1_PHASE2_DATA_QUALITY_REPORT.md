# V0.1 Phase 2 数据质量报告

`V0_1_PHASE2_STATUS: READY_FOR_USER_VALIDATION`

日期：2026-07-29  
诊断性质：本地只读派生  
真实用户数据接触：否

## 数据契约

SavedItem 现在分别保留原始字段与派生字段：

- 原始且不被清洗覆盖：rawTitle、rawText、rawShareText、sourceUrl、userNote。
- URL 派生：canonicalSourceUrl、sourceId、sourceUrlStatus、lastUrlCheckedAt。
- 内容派生：normalizedTitle、normalizedContent、normalizationVersion、normalizationWarnings。
- 用户修复：userCorrectedSourceUrl；打开和重新整理时优先，系统不覆盖。
- 时间：importedAt、createdAt、updatedAt。

本轮没有变更 IndexedDB schema、迁移流程、分类、专辑或搜索算法；新增字段沿用现有 JSON AppState 的向后兼容归一化。

## normalizedContent 结果

当前 normalizationVersion 为 4。清洗覆盖分享模板、打开小红书提示、平台来源文案、点赞/收藏/评论/分享与互动数字、重复标题、重复作者和无意义平台 hashtag；保留正文线索与非平台噪音。rawTitle/rawText 不变，清洗后为空时回退 rawText 并记录 `normalized_content_empty_fallback_raw`，原始正文为空时记录 `raw_text_empty`。

自动测试已证明：

- 输入 rawText 中的互动量和分享模板仍保留在 rawText；
- normalizedContent 不含这些模板噪音；
- normalizationVersion 存在；
- 清洗失败有 warning，不静默丢数据。

## 只读诊断

设置页新增“数据完整性诊断”，只从当前 savedItems 派生以下统计，不写回业务数据：

| 指标 | 自动实现 | 真实库结果 |
| --- | --- | --- |
| 总收藏数 | PASS | 待用户本地查看 |
| 有 sourceId 数 | PASS | 待用户本地查看 |
| 有有效 sourceUrl 数 | PASS | 待用户本地查看 |
| normalizedContent 非空数 | PASS | 待用户本地查看 |
| 空标题数 | PASS | 待用户本地查看 |
| 空正文数 | PASS | 待用户本地查看 |
| 重复候选数 | PASS | 待用户本地查看 |
| 无法解析链接数 | PASS | 待用户本地查看 |
| 用户修复链接数 | PASS | 待用户本地查看 |
| normalization warning 数 | PASS | 待用户本地查看 |

错误列表只显示 stableHash 生成的脱敏 ID 和错误类型，例如 SOURCE_ID_MISSING、SOURCE_URL_INVALID、NORMALIZED_CONTENT_EMPTY、TITLE_EMPTY、RAW_TEXT_EMPTY、NORMALIZATION_WARNING；不会显示真实标题、正文、完整 URL 或 token。专项测试验证诊断 JSON 不含 fixture 正文。

## 去重与导入质量

去重优先级为 sourceId → canonicalSourceUrl → title + author + normalized excerpt hash。ImportBatch 额外统计 batchDuplicates、existingLibraryDuplicates、unresolvedDuplicates；重复条目标记为 duplicate/已存在，不计 failed。自动专项测试结果：同 sourceId、不同 query token 的两条只新增 1；同标题但不同 sourceId/作者/正文的笔记各自新增；再次导入现有两条时新增为 0，existingLibraryDuplicates 为 2。

## 自动验证汇总

- Phase 2 专项 + 原帖既有用例：8/8 PASS。
- Extension validation / DOM / checkpoint reload：PASS。
- storage-runtime：70 tests / 295 assertions PASS。
- storage-service：181 tests / 826 assertions PASS。
- 核心 E2E：132/132 PASS。
- `pnpm typecheck`、`pnpm build`、扩展 Preview profile 校验：PASS（最终提交前再次复核）。

## 待用户确认

真实库的 sourceId 覆盖率、normalizedContent 覆盖率、重复候选与不可解析链接数量只能在用户本地诊断页读取。本报告不提交这些记录的正文或 URL；收到脱敏数量后再判断是否存在 Phase 2 Blocking。