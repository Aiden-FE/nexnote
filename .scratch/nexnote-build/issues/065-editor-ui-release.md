# DEV-065 · 编辑器 UI 修正轮次集成与 v0.0.18 发布

Type: dev
Module: release
Status: ready-for-agent
Blocked by: DEV-061、DEV-062、DEV-063、DEV-064
Depends: 全部本轮实现票
Effort: L
Priority: P0

## What to build

把本轮编辑器 UI 修正完整集成进 master，执行仓库统一验收协议，并发布新的桌面版本。发布包含真实可验证的自动化门禁、打包 smoke、QA evidence、immutable tag 与 GitHub Release；不得虚报外部人工验收。

用户视角的完成标准：用户可下载的新版本包含 gutter、菜单约束、划词工具栏图标和折叠交互的全部修复；发布资产、tag、QA evidence 与仓库记录一致。

## Acceptance criteria

- [ ] DEV-061～064 全部合入 master，并更新 checkpoint、ledger 与票据状态。
- [ ] 更新 ADR-0004 / ADR-0013，记录 gutter 几何、菜单视口约束、SVG 图标管线、折叠呈现与快捷键、按层级折叠及“不提供 Fold All”的延续决策。
- [ ] 固定发布候选 SHA 通过六门禁和 release-config 验证。
- [ ] macOS arm64 packaged smoke 通过并绑定 `NEXNOTE_SMOKE_CANDIDATE_SHA` 与版本证据。
- [ ] 根 `package.json` 版本提升至 v0.0.18，并按仓库模式提交版本准备提交。
- [ ] 生成并绑定 `docs/release/qa/v0.0.18.json` immutable evidence；设置 release variables。
- [ ] 创建并推送 immutable annotated tag `v0.0.18`；Release workflow 全绿后完成 publish，回读资产数量与摘要。
- [ ] 发布完成后更新 checkpoint/ledger 的 release 记录；本地 ABI 状态恢复。

## Blocked by

DEV-061、DEV-062、DEV-063、DEV-064.

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
