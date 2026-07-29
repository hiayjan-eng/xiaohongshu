# V0.1 Phase 2 扫描报告

`V0_1_PHASE2_STATUS: READY_FOR_USER_VALIDATION`

日期：2026-07-29  
分支：`v0.1-core-library-release`  
真实用户数据接触：否  
Production 修改：否

## 结论

Phase 2 已解除扫描器原有的 20 条硬上限，扩展现在支持 10 / 20 / 50 / 100 / 200 五档目标，并持久化完整 checkpoint。自动化已验证目标归一化、进度字段、脱敏 DOM 提取、暂停后的状态保存、扩展脚本重新加载后的 checkpoint 恢复、稳定 sourceId 去重，以及 Preview/Production profile 隔离。

自动验证不能替代本人小红书收藏页的真实扫描。20 / 100 / 200 条的真实数量误差、连续滚动稳定性和真实重复导入新增数仍为空，因此当前状态只能是 `READY_FOR_USER_VALIDATION`，不能写成 PASS。

## 实现基线

- 目标档位：10 / 20 / 50 / 100 / 200；未知目标安全回落到 20。
- 单批候选提取上限从 20 放宽到 200，最终有效条数仍按 target 截断。
- checkpoint 持久化：`targetCount`、`discoveredCount`、`validCount`、`duplicateCount`、`invalidCount`、`currentStage`、`lastVisibleCardKey`、`scrollPosition`、`startedAt`、`updatedAt`、`paused`、`completed`。
- popup 关闭、重新打开及扩展脚本重新加载时，从 `revival-extension-scan-state` 恢复；恢复后沿用已有 items 和 selectedKeys，不从 0 创建新批次。
- 暂停会设置 stopRequested；滚动结束后在提取前再次检查暂停状态，避免暂停期间继续提取。
- DOM 变化后允许重新建立候选，但 itemKey 按 sourceId、canonicalSourceUrl、title + author + normalized excerpt hash 去重。
- 诊断统计包含目标、发现、有效、重复、无效、缺链接、过滤数、过滤原因与当前阶段；复制诊断不包含标题、作者、正文或完整链接。

## 自动验证结果

| 项目 | 结果 | 证据边界 |
| --- | --- | --- |
| 10/20/50/100/200 target | PASS | 扩展 validation 逐档断言 |
| target 与有效进度一致 | PASS | UI/状态字段按 validCount / targetCount 计算 |
| 暂停停止后续提取 | PASS（实现与静态/状态测试） | 仍需真实滚动页观察 |
| checkpoint 保存 | PASS | 必填字段自动断言 |
| 扩展 reload 恢复 | PASS | 注入已保存的 100 条 checkpoint，消息链恢复 target/discovered/items/sourceId |
| popup 重开恢复 | PASS（共享 storage 状态链） | 仍需真实人工操作 |
| query token 稳定去重 | PASS | 同 sourceId、不同 xsec token 的 key 相同 |
| profile ID 排除 | PASS | profile URL 不产生 sourceId |
| 受限/验证码诊断 | PASS（既有 DOM 回归） | 不绕过平台限制 |
| Extension DOM fixture | PASS | 脱敏 fixture，不计真实扫描 |

## 真实扫描验收表

| 目标 | 扩展版本 | 开始/完成 | 发现 | 有效 | 重复 | 无链接 | 失败 | 暂停/继续 | popup 恢复 | 扩展 reload 恢复 | 首次导入新增 | 重复导入新增 | 状态 |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | --- |
| 20 | 0.2.5-preview | 待用户填写 | — | — | — | — | — | 待测 | 待测 | 待测 | — | — | PENDING |
| 100 | 0.2.5-preview | 待用户填写 | — | — | — | — | — | 待测 | 待测 | 待测 | — | — | PENDING |
| 200 | 0.2.5-preview | 待用户填写 | — | — | — | — | — | 待测 | 待测 | 待测 | — | — | PENDING |

10 和 50 已作为可选档位通过自动校验；文件规定的真实发布门以 20 / 100 / 200 为准。报告不得填写真实正文、作者、完整 URL、token 或用户 ID，只记录数量、时间和脱敏 hash。

## 发布门判断

当前尚不能计算真实数量误差，也不能证明 200 条连续扫描稳定或第二次真实导入新增为 0。用户完成三档真实验收并回填统计后，才能把本报告状态评为 PASS。