# DEV-125 Electron 退役与默认通道切换

- 状态：blocked
- 分类：architecture / release
- 优先级：P2
- 工作量：L
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-115 至 DEV-124、ADR-0028

## 背景

Electron 退役只能在 Tauri 已覆盖产品能力并通过三平台发布与 QA 后发生。当前 Windows/Linux 无本机实测条件，因此本票天然 blocked，不能因 macOS 或 CI 构建通过而提前执行。

## 方案

1. 建立 cutover checklist，逐项引用 DEV-115 至 DEV-124 的完成证据。
2. 发布 Tauri alpha/beta 通道，与 Electron 并行保留至少一个可回退周期。
3. 验证用户数据迁移与兼容：
   - vault 结构不变；
   - app data 设置、最近 vault、AI Profile / secret、插件状态迁移或显式重新授权；
   - 更新通道从 Electron 到 Tauri 的迁移策略。
4. 完成文档、官网下载入口、FAQ、Release notes 与支持边界更新。
5. 最后才移除 Electron main/preload、electron-builder、updater 与相关 CI。

## 验收标准

- [ ] DEV-115 至 DEV-124 全部 done；环境阻塞项已补证或由用户明确接受并另立决策。
- [ ] Tauri alpha/beta 至少完成一个真实升级周期。
- [ ] 用户数据迁移 / 重新授权路径实测。
- [ ] 官网与 GitHub 默认下载指向 Tauri，且保留回退方案。
- [ ] Electron 依赖与发布链路移除后全仓 typecheck/lint/test/build 通过。
- [ ] 本票当前 **blocked**：Windows/Linux 真实 GUI/安装/更新无实测条件。

## Out of scope

- 在三平台证据缺失时删除 Electron。
- 在无用户确认时接受功能降级。
