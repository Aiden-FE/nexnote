# NexNote v0.1.0 Release Notes

> 首个 MVP 内测版（dev channel）。本文件只记录已实现能力与当前验证边界；没有真实证据的发布项明确标为 `NOT_RUN`，不以构建、单测或 smoke 结果替代。

**版本号**: `0.1.0`
**发布类型**: MVP / Alpha 内测
**代码基线**: `master` @ `00c858c`（DEV-016 合并完成），本票在 `dev/DEV-019` 分支集成验收

---

## 核心能力

### 编辑器（块编辑器 × Markdown）

- TipTap 3 内核 + Obsidian 方言兼容
- 块级操作：拖拽排序、折叠、块菜单、块锚点 `^id`
- Wikilink `[[target|alias]]`、嵌入 `![[target]]`、锚点 `#heading` / `^block-id`
- Frontmatter：`aliases`、`tags`、`created`、`updated`、`confidence_boost`
- 斜杠菜单（`/`）、气泡菜单、上下文菜单
- Mermaid 图表、KaTeX 数学公式（内置插件）
- Callout `> [!note]` 等 Obsidian 风格

### 知识管理

- 页面树、标签树、反链面板
- 全局图谱 + 局部图谱（可按标签/目录/孤立页过滤）
- 页面重命名自动回写全库 wikilink
- Obsidian vault 一键打开（方言兼容）

### 搜索与召回

- FTS5 全文搜索（CJK 子串 + 拉丁前缀）
- 三阶段渐进式召回：FTS 粗筛 → 双链邻居扩展 → 向量重排
- 置信度引擎（简化 PageRank + 修订/作者/年龄/稳定性六因子加权）
- 多 Skill 检索系统：内置检索 + 快速关键词 + 插件贡献 Skill，合并去重重排

### AI

- AI 对话 Dock（会话即页面，保存在 `AI Chats/` 目录）
- 写作辅助：续写 / 改写 / 扩写 / 总结
- 多 Provider 支持：OpenAI 兼容、本地 Embedding
- 密钥仅存系统钥匙串（Keychain / Credential Manager / Secret Service）

### Git 版本化

- 自动提交（默认 30s 防抖，可配置）
- 手动提交 / 时间线 / 文件历史 / 恢复到历史版本
- 远程仓库 clone / push / pull（preflight + 一次性授权 token）
- 冲突标记保护：存在 `<<<<<<<` 时拒绝自动提交

### 插件系统

- iframe 沙箱运行时，RPC 能力调用
- 六档权限（read / edit / filesystem / network / external-command / desktop-privileged）
- 贡献点：commands / menus / views / blockTypes / skills
- 审计日志、权限撤销、热加载/热卸载
- 内置插件：Mermaid、KaTeX

### 设置与首启动

- 全局设置（SettingsService 单一权威） + vault 级设置
- 八区设置面板：通用 / 编辑器 / Git / AI / 召回 Skill / 插件 / 快捷键 / 关于
- 首启动向导：新建 / 打开 / 克隆 / Obsidian 导入
- sender 生命周期管理：关闭向导自动回收操作 token / clone token

---

## 打包、安装与更新边界

- CI 配置三平台发布产物：macOS Intel（x64）与 Apple Silicon（arm64）、Windows x64、Ubuntu x64。
- macOS 发布形态为 **Ad hoc 签名、未公证**；首次启动可能被 macOS 隔离。用户应核对架构和校验和，将应用拖入 Applications；按安装说明执行首次 `xattr -d com.apple.quarantine /Applications/NexNote.app`，并记录实际结果。
- macOS Ad hoc 包不承诺应用内自动安装更新。无法自动安装时，应用内入口应引导用户到 GitHub Releases，手动下载匹配 Intel/Apple Silicon 的包。
- Windows 的 **NSIS installer** 和 Ubuntu 的 **AppImage** 是自动更新主路径；Windows `portable` 和 Ubuntu `deb` 是额外手动格式。
- 生成的 metadata、CI smoke 或配置校验不等于真实平台安装或升级验收。
- 发布流程、产物命名和 updater 行为以仓库现有实现为准；本切片只补充文档和 QA 边界。

---

## 已修复 & 打磨（DEV-019）

- **端到端集成测试**：vault 创建 → 索引 → 搜索 → 双链 → 图谱 → 召回 → 置信度 → Skill → 插件 → Chat 服务，纯逻辑真实代码路径全部走通
- **性能时间盒**：测试为千页 / 8k 块 / 3k 链接 vault 设置了上限断言（索引 < 30s、搜索 < 150ms、PageRank < 3s、图谱 < 1.5s）；开发机实测远低于上限——全量索引约 210ms、搜索约 8ms、PageRank 约 280ms、图谱约 90ms（实测值不构成性能承诺）
- **空 vault 边界**：搜索/图谱/召回在空库下安全降级，无抛错
- **Obsidian 方言回归**：wikilink 大小写不敏感、alias 优先、frontmatter 标签 + 行内标签统一索引
- **索引增量更新保护**：相同 hash 文件不触发全量置信度重算（graph 结构不变时只传增量 paths）
- **文档补齐**：用户手册、快捷键速查表、插件开发文档、FAQ

---

## 已知限制（v0.1.0 MVP）

- **协作**：单用户；Git 冲突需手动解决，无实时多人协作
- **移动端**：仅桌面（macOS / Windows / Linux）
- **云同步**：仅 Git 远程，无 NexNote 官方云
- **本地模型质量**：本地 embedding 语义精度低于云端模型
- **插件生态**：API v1.0.0 是最小可用集，复杂能力（侧边栏自定义视图、独立窗口）后续补充
- **性能上限**：万级页面未做专项优化；千级页面已验证在时间盒内

---

## 测试覆盖（本地 CI）

| 项 | 数量 |
| --- | --- |
| 测试文件 | 72+ |
| 通过测试 | 600+ |
| 端到端集成用例 | 4 个 |
| 性能时间盒用例 | 3 个（含 500→1000 页线性度检查） |
| 门禁命令 | 7 项全绿（typecheck / lint / test / build / verify-release-config / check-changed-format / diff --check） |

这些结果仅覆盖当前代码基线的可自动化部分。详细发布 gate 与证据要求见 [QA-CHECKLIST.md](../../docs/release/QA-CHECKLIST.md)。

---

## NOT_RUN（必须人工完成）

以下项目在当前环境没有完成，任何 Release notes 或发布公告都不得将其写成通过：

| # | 项 | 当前状态 | 必须补的证据 |
| --- | --- | --- | --- |
| 1 | macOS Ad hoc 签名与首次安装 | `NOT_RUN`：没有目标平台安装记录和完整签名证据 | Intel 与 Apple Silicon 分别安装；记录 `uname -m`、签名模式、首次启动和首次 `xattr` 结果 |
| 2 | macOS 公证/Gatekeeper | `NOT_RUN` / 不适用当前 Ad hoc 形态：本 release 未公证 | 不得声称 notarization、Gatekeeper 无警告或 `spctl accepted`；若分发策略改变需另行发布证据 |
| 3 | Windows 真实安装与签名 | `NOT_RUN` | Windows 11 x64 NSIS 安装/卸载、Authenticode 和 SmartScreen 结果 |
| 4 | Ubuntu 真实安装与签名 | `NOT_RUN` | Ubuntu x64 AppImage 主路径、deb 手动格式和实际 `.asc` 验证 |
| 5 | N-1 真实网络升级 | `NOT_RUN` | 从公开 N-1 版本分别验证 Windows NSIS、Ubuntu AppImage，以及 macOS 失败时跳 GitHub Releases 的手动路径 |
| 6 | 失败重试、暂停 feed、前滚修复、人工旧版恢复 | `NOT_RUN` | 按 [QA 清单](../../docs/release/QA-CHECKLIST.md) runbook 演练并记录日志、操作者和结果 |

在上述证据补齐前，现有 smoke、单元测试、构建成功和配置校验只能作为自动化证据，不代表真实平台发布完成。

---

## 升级说明

- 从更早的 DEV 版本（< 0.1.0）升级：请先备份 vault，首次打开会自动迁移 `.nexnote/index.db` schema（SCHEMA_VERSION 5）
- v0.1.0 是首个公开内测版，后续小版本保持 vault 向后兼容；破坏性变更（如索引 schema 不兼容）会提升主版本号并提供迁移脚本

---

## 反馈

内测反馈请在仓库 issue 区提交，标签 `release/v0.1.0`。
