---
status: accepted
---

# `.nexnote/` 版本化策略：仅缓存不进库，配置与布局纳入版本化

DEV-007 交付 Git 底座时需要决定「vault 内的 `.nexnote/` 目录是否纳入版本化」。本 ADR 与 ADR 0002（Git 绑定策略）一同生效。

## Decision

`.nexnote/` 在 vault 内**整体保持本地**：默认 `.gitignore` 拒绝 `.nexnote/` 整目录，但显式 allowlist `.nexnote/config.json` 与 `.nexnote/layout.json`（以及未来的其他可重建配置）。搜索/索引、临时缓存、锁文件、数据库文件等运行时产物始终留在本地。

为堵住 `.DS_Store`、数据库、索引等内部内容被误提交的路径，应用层额外建立**知识库同步护栏（Vault Sync Guard）**：

1. **默认 `.gitignore` 模板**覆盖 `.DS_Store`、`Thumbs.db`、`desktop.ini` 等 OS 临时文件，以及 `.nexnote/` 运行时产物；
2. **所有 vault 绑定路径**（新建、克隆导入、打开已有仓库、启动恢复上次 vault）均执行幂等模板修复；
3. **staging 前二次拒绝**：即使 `.gitignore` 缺失或被用户改坏，`GitService.commit()` 在 `git add .` 之前显式过滤掉敏感路径；
4. **存量迁移**：检测到已跟踪的违规路径时自动 `git rm --cached`（文件保留在磁盘），随下一次提交移除。

首期护栏的最小强制集合是 `.DS_Store`、`Thumbs.db`、`desktop.ini`，以及 `.nexnote/` 下除 `config.json`、`layout.json` allowlist 外的全部文件与目录。其他运行时数据库通过 `.gitignore` 模板覆盖；插件缓存与日志不由本护栏强制，避免与插件自身存储策略耦合。

护栏对未跟踪的违规文件采用静默跳过并记录日志，避免中断正常编辑与自动提交；对已跟踪的违规文件执行幂等 `git rm --cached`。克隆导入的远程仓库即使历史中已经包含这些文件，也只在本地停止继续跟踪，不改写远程历史。

## 落地位置

- `.gitignore` 模板与修复：`packages/main/src/git/git-service.ts::writeDefaultGitignore`。
- 幂等修复触发点：`VaultSession.open()`、`vault:clone` 完成后的打开、`vault:open` 与启动恢复路径；旧逻辑中仅在 `initGit=true` 时修复的缺口已补齐。
- allowlist 维护：`writeDefaultGitignore` 同步更新——添加新的可重建配置时需同时更新 ADR、gitignore 模板与同步护栏路径。
- 知识库同步护栏：
  - 提交前过滤：`packages/main/src/git/git-service.ts::commit` 在 `git add(['.'])` 之前拒绝敏感路径；
  - 存量 untrack：`packages/main/src/git/git-service.ts::untrackIgnoredNexnoteArtifacts` 扩展为同时处理 `.DS_Store` 与 `.nexnote` 非 allowlist 文件。
- 测试：`packages/main/tests/git-service.test.ts` 已断言 `.nexnote/index/` 与 `.nexnote/cache/` 被忽略，并新增断言验证 `.nexnote/config.json` 被显式 allowlist；护栏行为与存量迁移需要对应新增测试。

## Considered Options

- **整体 ignore `.nexnote/`**：实现最简单，但跨设备配置同步（快捷键、布局、AI 偏好）失效。
- **整体保留 `.nexnote/`**：体积爆炸、索引文件跨平台不一致、克隆成本高。
- **allowlist（采纳）**：配置文件保留可重建语义，缓存与索引保持本地。
- **仅依赖 `.gitignore` 第一道防线**：用户在导入/打开已有仓库时可能缺少 `.gitignore`，或被其他工具改坏，无法保证运行时产物不进库；因此增加应用层同步护栏作为第二道防线。
- **遇到已跟踪违规文件时静默删除历史记录**： rejected，会改写 Git 历史，破坏协作；改为 `git rm --cached` 保留历史但停止继续跟踪。

## Consequences

- 后续每次新增「可重建配置文件」都需要同步更新 gitignore 模板、同步护栏路径与 ADR；流程已在 `GitService.writeDefaultGitignore` 中显式注释。
- `vault:create` → `git init` 后的初始提交里能看到 `.nexnote/config.json` 已被加入工作区并被提交；索引/缓存目录存在但未被跟踪。
- 已存在的 vault 在升级到本版本时，`writeDefaultGitignore` 会幂等地补齐 ignore 模板，`untrackIgnoredNexnoteArtifacts` 会清理已跟踪的运行时文件，不会删除用户已有规则或磁盘文件。
- 同步护栏意味着 `git add .` 不再无条件执行；应用层必须在提交前计算允许的路径集合，失败时给出明确错误。
