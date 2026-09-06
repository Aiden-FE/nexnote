---
status: accepted
---

# `.nexnote/` 版本化策略：仅缓存不进库，配置与布局纳入版本化

DEV-007 交付 Git 底座时需要决定「vault 内的 `.nexnote/` 目录是否纳入版本化」。本 ADR 与 ADR 0002（Git 绑定策略）一同生效。

## Decision

`.nexnote/` 在 vault 内**整体保持本地**：默认 `.gitignore` 拒绝 `.nexnote/` 整目录，但显式 allowlist `.nexnote/config.json` 与 `.nexnote/layout.json`（以及未来的其他可重建配置）。搜索/索引、临时缓存、锁文件、数据库文件等运行时产物始终留在本地。

理由：

1. 配置与布局是 vault 语义的一部分——它们在不同设备间必须一致（命令面板快捷键布局、侧栏宽度、AI 偏好等）。
2. 索引与缓存是本机派生数据，体积大、不稳定、不同 OS 上的二进制布局可能不同；提交它们会拖累仓库体积与跨平台恢复体验。
3. allowlist 写法对已有 vault 用户是兼容升级：默认 `.gitignore` 用 `!.nexnote/config.json` 重新引入配置条目，旧 vault 升级时由 `GitService.writeDefaultGitignore` 幂等补齐。

## 落地位置

- 写入逻辑：`packages/main/src/git/git-service.ts::writeDefaultGitignore`。
- allowlist 维护：上述函数同步更新——添加新的可重建配置时需同时更新 ADR 与 gitignore 模板。
- 测试：`packages/main/tests/git-service.test.ts` 中已断言 `.nexnote/index/` 与 `.nexnote/cache/` 被忽略，并新增断言验证 `.nexnote/config.json` 被显式 allowlist（不进入忽略）。

## Considered Options

- **整体 ignore `.nexnote/`**：实现最简单，但跨设备配置同步（快捷键、布局、AI 偏好）失效。
- **整体保留 `.nexnote/`**：体积爆炸、索引文件跨平台不一致、克隆成本高。
- **allowlist（采纳）**：配置文件保留可重建语义，缓存与索引保持本地。

## Consequences

- 后续每次新增「可重建配置文件」都需要同步更新 gitignore 模板与 ADR；流程已在 `GitService.writeDefaultGitignore` 中显式注释。
- `vault:create` → `git init` 后的初始提交里能看到 `.nexnote/config.json` 已被加入工作区并被提交；索引/缓存目录存在但未被跟踪。
- 已存在的 vault 在升级到本版本时，`writeDefaultGitignore` 会幂等地补齐 ignore 模板，不会删除用户已有规则。
