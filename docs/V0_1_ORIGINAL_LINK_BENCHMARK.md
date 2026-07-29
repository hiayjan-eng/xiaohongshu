# V0.1 原帖链接验收集与基线

`V0_1_ORIGINAL_LINK_STATUS: FAIL_BLOCKING`

## 口径与隐私边界

- 数据版本：`2026-07-29.phase1`
- 数量：20 条；均为合成 URL 或错误输入，不指向真实用户收藏。
- L01–L12 是应可导入并直接打开的合成原帖形态；L13–L20 是缺失、错误、外站或 profile 反例。
- 合成 URL 只能验收解析、保存、去重、入口和 `window.open` 参数，不能证明小红书真实页面仍存在或可见。
- 因未使用真实用户内容，本轮“有效链接真实打开成功率”没有合格分母，记为 `N/A / FAIL_BLOCKING`，不得用 2 条现有 E2E 的 `window.open` spy 冒充 ≥95% 的线上成功率。
- 真实用户数据接触：否。

## 20 条验收数据

| ID | 合成输入 | 期望 | Phase 1 基线判断 |
| --- | --- | --- | --- |
| L01 | `https://www.xiaohongshu.com/explore/v01-link-001` | 原样保存；新标签直开 | 当前管线可保存；`window.open(..., "_blank", "noopener,noreferrer")` |
| L02 | 分享文本内含 `https://www.xiaohongshu.com/explore/v01-link-002` | 从文本提取并保存 | 现有 E2E 覆盖同形态，PASS（结构） |
| L03 | `https://www.xiaohongshu.com/explore/v01-link-003?xsec_token=synthetic&xsec_source=pc_collect` | 保留查询参数 | URL 归一化保留 query，PASS（静态） |
| L04 | `https://www.xiaohongshu.com/explore/v01-link-004#comment` | 去除 fragment 后保存 | `normalizeUrl` 明确清除 hash，PASS（解析） |
| L05 | `https://www.xiaohongshu.com/discovery/item/v01-link-005` | 作为原帖直开 | 扫描器识别该路径；Web 不改写，PASS（结构） |
| L06 | `https://xhslink.com/a/v01link006` | 保存短链并直开 | 识别为小红书平台；未验证真实跳转，PARTIAL |
| L07 | `http://www.xiaohongshu.com/explore/v01-link-007` | 明确是否升级 HTTPS；不静默改错 | 当前接受 HTTP 且原样打开，安全/契约未定义，FAIL |
| L08 | 分享文本末尾 URL 后有中文句号 | 去除标点并保存正确 URL | `splitUrlFromText/trimUrl` 覆盖，PASS（解析） |
| L09 | `sourceUrl` 为空，正文含 `/explore/v01-link-009` 完整 HTTPS URL | 从正文回填 | 当前支持，PASS（解析） |
| L10 | URL 前后有空格和换行 | 去空白后保存 | 当前支持，PASS（解析） |
| L11 | 与 L01 完全相同的第二次导入 | 新增数为 0 | URL 小写键去重；现有导入测试覆盖重复路径，PASS（结构） |
| L12 | 同一 URL 仅 fragment 不同 | 应识别为同一原帖 | 归一化先去 hash，可按同一 URL 去重，PASS（静态） |
| L13 | 空 URL，但有标题 | 允许先整理；入口禁用；提示可修复链接 | 可导入且入口禁用；没有“补充/修复链接”操作，PARTIAL |
| L14 | `javascript:alert(1)` | 拒绝为 sourceUrl，绝不打开 | 导入归一化拒绝非 HTTP(S)，PASS（新导入） |
| L15 | `https://www.xiaohongshu.com/user/profile/synthetic` | 不得作为原帖打开 | 当前会接受并直接打开 profile URL，FAIL |
| L16 | `xiaohongshu.com/explore/v01-link-016`（无协议） | 明确提示无效并允许修复 | 当前 URL 解析为空；无修复入口，FAIL |
| L17 | `https://example.test/not-xhs-post` | 标记为 other，不冒充小红书原帖 | `sourcePlatform=other`，但仍可按“打开原帖”直开，PARTIAL |
| L18 | `https://www.xiaohongshu.com/explore/`（无 sourceId） | 诊断为非具体原帖 | 当前接受并打开，FAIL |
| L19 | 已删除/不可见的合成状态 | 提示“原帖可能已删除、不可见或链接已失效” | 当前没有打开后的可达性检测或该状态提示，FAIL |
| L20 | 用户手动修复 L13 的 URL | 保存修复值并从卡片/搜索/专辑直开 | 当前没有链接编辑/修复入口，FAIL |

## 基线

| 指标 | 当前 | 目标 | 差距 | 结论 |
| --- | ---: | ---: | ---: | --- |
| 真实有效链接打开成功率 | N/A（0 条合格真实链接） | ≥95% | 无法计算 | FAIL_BLOCKING |
| 合成链接解析/保存结构检查 | 11 PASS / 20；3 PARTIAL；6 FAIL | 20/20 满足各自预期 | 9 条未完整通过 | FAIL |
| `sourceUrl` 保存 | 有 | 必须 | — | PASS（新导入路径） |
| `sourcePlatform` 保存 | 有 | 必须 | — | PASS |
| `sourceId` 提取/保存 | 0/20；数据类型无稳定字段 | 可提取时必须 | 缺 20 条结构证据 | FAIL |
| 新标签直开且 noopener | 有 | 必须 | — | PASS |
| 收藏卡入口 | 有 | 必须 | — | PASS |
| 搜索结果入口 | 有 | 必须 | — | PASS |
| 专辑详情入口 | 有 | 必须 | — | PASS |
| 失效状态提示 | 无 | 必须 | 缺失 | FAIL |
| 用户补充/修复链接 | 无 | 必须 | 缺失 | FAIL |

## 现有实现证据

- `createSavedItemRecord` 保存 `sourceUrl` 并按 URL 推断 `sourcePlatform`，但 `SavedItem` 没有稳定 `sourceId` 字段。
- `parseShareInput` 可从分享文本提取 HTTP(S) URL、移除尾部中文标点并清除 fragment。
- `openSource` 只检查字符串非空，然后直接 `window.open`；没有校验具体原帖路径、profile URL、可达性或失效状态。
- 收藏卡、搜索结果、详情和专辑详情均存在打开入口；缺链接时按钮通常直接禁用，只显示“暂无原帖链接”。
- 现有 11 项回归中，`import-parsing.spec.ts` 验证完整分享文本可提取 URL，`search.spec.ts` 验证搜索结果调用新窗口；两者都是合成 spy，不是线上可达性测试。

## Blocking 与下一阶段边界

Phase 2 最小任务必须先补 `sourceId` 提取、具体原帖 URL 校验、profile/非具体路径拒绝、失效提示和用户修复入口，然后使用不入库的 20 条真实可见/失效链接做人工复验并记录时间、入口和结果。真实链接只在本地验收，不提交 URL、标题、作者或 sourceId。
