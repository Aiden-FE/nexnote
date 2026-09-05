# 03 · Git 集成与文档历史研究

Type: research
Status: claimed

## Question

为 NexNote 的 Git 底座（差异化核心）提供方案事实依据：

1. Git 绑定技术路线对比：simple-git（spawn 系统 git）vs isomorphic-git（纯 JS）vs Rust 侧绑定（gitoxide / libgit2，若选 Tauri）——功能覆盖（worktree、partial clone 等是否需要）、性能、license、与「优先用户环境 git，无受支持版本则回退应用内捆绑 git」策略的适配。
2. 捆绑 git 分发：各平台体积、license 合规（GPL v2 例外条款）、已有桌面应用先例（如 VS Code / Obsidian Git 插件的做法）。
3. 单篇文档的版本历史与回滚：基于 `git log --follow -- <file>` 等方式的可行性、块级 vs 文件级回滚的取舍。
4. 自动提交策略：变更检测 → commit 粒度 / 频率的常见做法。
5. 置信度数据源：从提交历史提取修改频次、更新时间、最近修订的命令面与开销。

产出建议路线 + 风险清单。
