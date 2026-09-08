# NexNote v0.1.0 Release Notes

> 首个 MVP 内测版（dev channel）。所有功能均可本地运行；三平台签名包、跨端物理安装验证、公证均为后续 release pipeline 交付，不在本票范围。

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

### 打包与自动更新

- electron-builder 三平台构建（macOS / Windows / Linux）
- electron-updater 自动更新（stable / beta / alpha 三通道）
- macOS 公证（`notarize.cjs`）、Linux GPG `.asc` 签名
- CI：PR 检查 / Nightly / Release 三流水线
- Release QA Environment 审批门 + immutable evidence

---

## 已修复 & 打磨（DEV-019）

- **端到端集成测试**：vault 创建 → 索引 → 搜索 → 双链 → 图谱 → 召回 → 置信度 → Skill → 插件 → Chat 服务，纯逻辑真实代码路径全部走通
- **性能时间盒**：测试为千页 / 8k 块 / 3k 链接 vault 设置了上限断言（索引 < 30s、搜索 < 150ms、PageRank < 3s、图谱 < 1.5s）；开发机实测远低于上限——全量索引约 210ms、搜索约 8ms、PageRank 约 280ms、图谱约 90ms（实测值不构成性能承诺）
- **空 vault 边界**：搜索/图谱/召回在空库下安全降级，无抛错
- **Obsidian 方言回归**：wikilink 大小写不敏感、alias 优先、frontmatter 标签 + 行内标签 统一索引
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
| Bug bash 回归用例 | 6 个 |
| 门禁命令 | 7 项全绿（typecheck / lint / test / build / verify-release-config / check-changed-format / diff --check） |

详细门禁结果见 [release-checklist.md](./release-checklist.md)。

---

## NOT_RUN（需人工步骤）

以下项无法在本地 Node 单测环境验证，必须人工完成：

| # | 项 | 原因 | 人工步骤 |
| --- | --- | --- | --- |
| 1 | 三平台签名与公证 | 无 Apple/Windows 证书、无公证凭据 | 用开发者证书在各平台签名并完成公证流程 |
| 2 | 三平台物理安装 | 无三台物理机 / 虚拟机矩阵 | 在 macOS / Windows / Linux 上实际安装并启动 |
| 3 | 真实 Obsidian vault 导入 | 无真实用户 vault 样本 | 拿一个真实 Obsidian vault 做打开 / 搜索 / 反链 / 图谱走查 |
| 4 | 崩溃恢复真实验证 | 单测无法模拟进程中途 kill | 在编辑大文件时 kill 进程，重启后验证数据完整、索引可重建 |
| 5 | 启动时间 < 3s 目标 | 打包后冷启动数据需真实机器 | 在 release 包上用秒表/Time Profiler 测冷启动 |
| 6 | Electron GUI 走查 | 单测是 headless，无真实浏览器 | 在打包产物上走查 UI 视觉、动画、空态、错误态 |
| 7 | 大文档编辑流畅度 | 单测不涉及渲染帧 | 在 1 万字 / 100 块长文档上实测输入流畅度 |
| 8 | 插件第三方安全审计 | 需要独立审计 | 对沙箱模型、RPC 边界、权限提升做专业安全审计 |
| 9 | 自动更新端到端 | 无发布服务器 | 从 v0.1.0 → 下一版本实测自动更新下载安装重启 |

---

## 升级说明

- 从更早的 DEV 版本（< 0.1.0）升级：请先备份 vault，首次打开会自动迁移 `.nexnote/index.db` schema（SCHEMA_VERSION 5）
- v0.1.0 是首个公开内测版，后续小版本保持 vault 向后兼容；破坏性变更（如索引 schema 不兼容）会提升主版本号并提供迁移脚本

---

## 反馈

内测反馈请在仓库 issue 区提交，标签 `release/v0.1.0`。
