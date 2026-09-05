# 03 · Git 集成与文档历史研究

Type: research
Status: resolved

## Question

为 NexNote 的 Git 底座（差异化核心）提供方案事实依据：

1. Git 绑定技术路线对比：simple-git（spawn 系统 git）vs isomorphic-git（纯 JS）vs Rust 侧绑定（gitoxide / libgit2，若选 Tauri）——功能覆盖（worktree、partial clone 等是否需要）、性能、license、与「优先用户环境 git，无受支持版本则回退应用内捆绑 git」策略的适配。
2. 捆绑 git 分发：各平台体积、license 合规（GPL v2 例外条款）、已有桌面应用先例（如 VS Code / Obsidian Git 插件的做法）。
3. 单篇文档的版本历史与回滚：基于 `git log --follow -- <file>` 等方式的可行性、块级 vs 文件级回滚的取舍。
4. 自动提交策略：变更检测 → commit 粒度 / 频率的常见做法。
5. 置信度数据源：从提交历史提取修改频次、更新时间、最近修订的命令面与开销。

产出建议路线 + 风险清单。

## Answer

**报告**：[docs/research/git-integration.md](../../../docs/research/git-integration.md)

**Gist**：
1. 建议主路线：**simple-git（spawn 真实 git CLI）为唯一 Git 引擎**，启动探测系统 git（基线 ≥ 2.23，因 `git restore`）→ 不满足则回退应用内捆绑便携 git（直接消费 dugite-native release 资产：Windows 27–45MB、macOS 39–63MB、Linux 9.6–41MB 压缩，解压约 141MB@Windows）。
2. 放弃 isomorphic-git（无 SSH/协议 v2/rebase merge/submodule，大库内存受限）与 gitoxide（push/ssh、merge/rebase/checkout 编排未完成）作主引擎；nodegit 维护停滞排除；git2-rs 仅作 Tauri 下性能备胎。
3. GPL 合规：进程隔离不传染主程序（GitHub Desktop = MIT 应用内置 GPL git 先例）；随附 GPLv2 文本 + 源码 offer（SOURCE_OFFER 模式）。Tauri sidecar 有 NSIS 重装不替换 bug（tauri#15134）需首启版本校验。
4. 单篇历史：按需 `git log --follow -- <path>` 可行（官方文档确认仅限单文件、rename 启发式、merge 内 rename 漏检——UI 标注兜底）；回滚 MVP = 文件级（`git restore --source` + 自动提交）+ hunk 级（`git apply -R`），块级只做编辑器 UX 映射，不在 git 语义层发明块级提交。
5. 自动提交：保存事件 debounce（10–30s idle）聚合 + 定时兜底（~10min 可关）+ 退出/失焦 flush；自动 commit 纯本地安全，push/pull 与 commit 解耦且默认关（VS Code autofetch 弹窗骚扰教训）；外部改动用 watcher + 节流 `git status`。
6. 置信度：一趟全历史 `git log --name-status --format='%H|%at'` 建本地索引 + commit 后增量（`<last>..HEAD`），统计不依赖 `--follow`（无法批量）；自动提交降权（机器可读消息格式）；逐文件循环 git log 在 1.2 万文件库需数分钟——必须批量。

**建议**：采用上述主路线（simple-git + 探测/捆绑回退 + dugite-native）；**备选**：仅当 Tauri 定案且高频读性能有实测瓶颈时，加 git2-rs 进程内读加速（双引擎，维护面×2，非 MVP 默认）。风险清单见报告 §7（GPL 合规、安装包膨胀、探测歧义、sidecar 重装、--follow 局限、hunk↔块不对齐、凭证弹窗、置信度失真等 10 项）。
