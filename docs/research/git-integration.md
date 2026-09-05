# Git 集成研究 · NexNote Git 底座方案事实依据

- 票据：`.scratch/nexnote-mvp/issues/03-git-integration-research.md`
- 日期：2026-09-05
- 范围：Git 绑定技术路线、捆绑 git 分发与 license 合规、单文件历史/回滚、自动提交策略、置信度数据源。
- 基线约束（来自 map.md）：单人 + AI 结对 → 低维护面是选型硬过滤器；Vault = 绑定单个 Git 仓库的本地 Markdown + YAML frontmatter；Obsidian vault 互操作；桌面壳（Electron/Tauri）尚在 01 号票并行研究中，本文对两条壳路线均给出适配结论。

## TL;DR 建议路线

**主路线：simple-git（spawn 真实 git CLI）作为唯一 Git 引擎；启动时探测用户系统 git（版本 + 能力探测，可显式覆盖），不满足时回退到应用内捆绑的便携 git（复用 dugite-native 产物）；单篇历史用按需 `git log --follow`，回滚 MVP 做文件级 + hunk 级；自动提交用「编辑器保存事件 debounce 聚合 + 固定间隔兜底 + 退出/失焦 flush」；置信度用一趟全历史 `git log --name-status` 建索引再增量维护，不依赖 `--follow`。**

核心理由：spawn 真实 git = 100% porcelain 兼容（worktree、partial clone、LFS、SSH 等一切随真实 git 走）、零原生模块、GitHub Desktop/Obsidian Git/VS Code 三大先例背书、与「优先用户 git」策略天然契合（simple-git 原生支持 `.customBinary(gitPath)`）；纯 JS 与 Rust 库实现（isomorphic-git / gitoxide / libgit2）各自存在决定性缺口（见 §1）。

---

## 1. Git 绑定技术路线对比

### 1.1 对比矩阵

| 维度 | simple-git（spawn 系统 git） | isomorphic-git（纯 JS） | gitoxide（Rust 库） | libgit2 / git2-rs（Rust 库） |
|---|---|---|---|---|
| 原理 | Node.js spawn git 子进程，封装 CLI | 纯 JS 重写 git，直接读写 `.git` | 纯 Rust 实现，`gix` crate 进程内调用 | libgit2 C 库的 Rust 绑定（git2-rs），进程内 |
| License | MIT（[npm](https://www.npmjs.org/package/simple-git)） | MIT（[GitHub](https://github.com/isomorphic-git/isomorphic-git)） | MIT OR Apache-2.0（[README](https://github.com/GitoxideLabs/gitoxide/blob/main/README.md)） | libgit2 = GPLv2 **with linking exception**，可被任意软件链接（[libgit2 README](https://github.com/libgit2/libgit2/blob/main/README.md)）；git2-rs 绑定 MIT/Apache 双许可 |
| 功能覆盖 | = 真实 git CLI 全集（worktree、partial clone、submodule、LFS、SSH、rebase 全部可用，取决于所 spawn 的 git 版本） | 缺 SSH 传输、无 wire protocol v2、无 rebase merge、无 submodule、浅克隆有但无 `--unshallow` 等价物（见 §1.2） | 读路径强（status/diff/merge-base/log），**push 与 ssh://、file:// 的自包含 clone/fetch 未完成**；merge/cherry-pick/revert/rebase/stash/checkout/restore/reset 编排未完成（[crate-status.md](https://github.com/GitoxideLabs/gitoxide/blob/main/crate-status.md)） | 覆盖广但滞后 git CLI；porcelain 编排（merge/rebase 等）与部分远端特性有缺口；SSH/凭证链路复杂 |
| 性能 | 每命令一次进程 spawn（桌面端毫秒级，笔记库规模可忽略）；重 status 可借 git 2.37+ `fsmonitor--daemon` 加速（见 §4.3） | 大仓库明显吃力：社区报告 15–20MB 仓库克隆冻结浏览器（[issue #292](https://github.com/isomorphic-git/isomorphic-git/issues/292)）；内存受限 | 设计目标即性能与正确性（README）；读操作快，但大仓库加速器（commit-graph、pack bitmaps、sparse-index、fsmonitor）多数未完成（crate-status.md） | 进程内、无 spawn 开销，status/diff/blame 快；但无 git CLI 的大仓库加速器生态 |
| 原生依赖 | 无（纯 JS 壳） | 无 | 需 Rust 工具链（仅 Tauri 侧） | 需编译/绑定；Node 侧的 nodegit 安装痛苦是知名问题（[isomorphic-git FAQ 对 nodegit 的评价](https://github.com/isomorphic-git/isomorphic-git/blob/main/docs/faq.md)） |
| 维护状态 | 活跃：12M+ 周下载、2013 年至今（npm） | 活跃但功能清单长期停滞 | 活跃（全职开发者），但完成度仍在推进（2025-01 `gix status` 才完整，[Discussion #1791](https://github.com/GitoxideLabs/gitoxide/discussions/1791)） | libgit2 活跃；**nodegit 半停滞**：npm 稳定版 0.27.0 发布于 6 年前，0.28.x 长期停留在 alpha（[changelog](https://github.com/nodegit/nodegit/blob/master/CHANGELOG.md)、[issue #2002](https://github.com/nodegit/nodegit/issues/2002)） |
| 与「优先用户 git，回退捆绑 git」的适配 | **最佳**：`.customBinary(gitPath)` 原生支持指定二进制（[README](https://github.com/steveukx/git-js)），探测→切换只是改一个路径 | 无此概念（自含引擎，不涉及外部 git） | 不适用（除非 Rust 侧另 spawn git 二进制） | 不适用（进程内库，与外部 git 二进制是两套引擎） |

### 1.2 isomorphic-git 决定性缺口（一手来源）

- **无 SSH**：核心永不内置 SSH（浏览器无法开 TCP 22 端口），Node/Electron 下理论上可作 remoteHelper 插件（[issue #231 维护者答复](https://github.com/isomorphic-git/isomorphic-git/issues/231)）；第三方 [jsgit-ssh](https://www.npmjs.com/package/jsgit-ssh) 存在但非官方。
- **无 wire protocol v2**（[FAQ](https://github.com/isomorphic-git/isomorphic-git/blob/main/docs/faq.md)）；HTTP(S) 代理仅 Node 下可换 http 插件。
- **浅克隆可用但无 `--unshallow` 等价**：官方建议逐页加深（FAQ）。
- **Obsidian Git 移动端实测**（同一 provider 模式下）：isomorphic 模式「very unstable」「serious limitations」——无 SSH 认证、内存限制库大小、无 rebase merge、无 submodule，可能崩溃于 clone/pull（[obsidian-git README](https://github.com/Vinzent03/obsidian-git)、[Getting Started](https://github.com/Vinzent03/obsidian-git/blob/master/docs/Getting%20Started.md)）。

### 1.3 gitoxide 决定性缺口（一手来源，2026-09 快照）

`crate-status.md` 明确未完成：`push` 与自包含 ssh://、file:// clone/fetch；`checkout/switch/restore/reset`、`merge/cherry-pick/revert`、`rebase`、`stash/am/apply` 的 porcelain 编排；sparse checkout；commit-graph/bitmaps/sparse-index/fsmonitor 等大仓库加速器（[crate-status.md](https://github.com/GitoxideLabs/gitoxide/blob/main/crate-status.md)）。credential helper 已可用（`git credential` 直跑）。**结论：今天不能作为唯一引擎**；作为读路径加速库是未来选项，但双引擎违背单人低维护面过滤器。

### 1.4 libgit2 / nodegit 补充

- libgit2 的 GPLv2 + linking exception 对闭源/任意 license 应用友好（[libgit2.org](https://libgit2.org/)），license 本身不是障碍。
- Node 侧绑定 nodegit 维护停滞（上表），Electron 路线应排除；Tauri 路线用 git2-rs 进程内加速高频读操作（status/diff/blame）技术上成立，但意味着「进程内库 + 外部 git 二进制」双引擎，porcelain 与远端仍要走 git CLI，复杂度×2，**不建议 MVP 采用**。

### 1.5 NexNote 是否需要 worktree / partial clone 等高级特性

MVP 不需要（Vault = 本地单仓库、无协同编辑、无 monorepo 场景）。选择 spawn 路线的额外收益是：这些能力随真实 git 免费获得，未来若做「页面级快照引用」「外部仓库引用」等无需更换底座。

---

## 2. 捆绑 git 分发

### 2.1 体积事实（一手 release 数据）

MinGit（Git for Windows 官方最小分发，专为嵌入第三方应用设计，非交互、可便携运行，[gitforwindows.org/mingit](https://gitforwindows.org/mingit.html)；License GPL-2.0，见 [2.53.0(4) release](https://github.com/git-for-windows/git/releases/tag/v2.53.0.windows.4)）：

| 产物 | zip 体积 |
|---|---|
| MinGit 2.53.0.4 x64 | 38.4 MB |
| MinGit 2.53.0.4 x86 | 39.4 MB |
| MinGit 2.53.0.4 arm64 | 37.1 MB |

dugite-native（GitHub 官方工具链，v2.53.0-4 release 资产实测）：Windows 用 MinGit 基底并附 Git-LFS + Git Credential Manager + 证书束；macOS/Linux 为自建精简分发（去 Perl、去 Tcl/Tk、symlink 压缩等，[README](https://github.com/desktop/dugite-native/blob/main/README.md)）：

| 平台 | .lzma | .tar.gz |
|---|---|---|
| windows-x64 | 27.4 MB | 44.9 MB |
| windows-arm64 | 24.7 MB | 43.0 MB |
| macOS-x64 | 43.5 MB | 63.1 MB |
| macOS-arm64 | 39.1 MB | 59.5 MB |
| ubuntu-x64 | 40.7 MB | 62.2 MB |
| ubuntu-arm64 | 9.6 MB | 22.1 MB |

解压后体积参考：Windows 下整份 git 分发约 **141 MB**（Apache maka 项目将 dugite 的 git 拷入 Electron `extraResources` 的实测值，[maka discussion #3411](https://github.com/apache/maka/discussions/3411)）。→ **安装包膨胀约 25–45 MB 压缩 / 约 40–140 MB 解压**，是可接受但必须预算的成本。

### 2.2 License 合规（GPLv2）

- git 二进制本体是 GPLv2，MinGit 分发标 GPL-2.0（见上）。**在安装包内分发 GPL 二进制 = 传达（convey）GPL 作品**，需满足 GPLv2 义务：随附许可证文本 + 提供对应源码（ Accompany 之源码或 written offer，GPLv2 §3）。
- **关键澄清**：GPL 义务落在「分发的 git 二进制」上；主程序以**独立进程边界** spawn git，不构成链接/衍生，主程序 license 不被传染。工作先例：GitHub Desktop（MIT 应用）内置 dugite 分发的 GPL git 并正常运行多年（[desktop/desktop](https://github.com/desktop/desktop)、[dugite](https://github.com/desktop/dugite)）。
- 现成合规模式：dugite-native 仓库携带完整 GPL-2.0 文本（[LICENSE.md](https://github.com/desktop/dugite-native/blob/main/LICENSE.md)）；Apache maka 在产物中放 `resources/licenses/git/SOURCE_OFFER.txt` 满足 GPLv2 written-offer 义务（[discussion #3411](https://github.com/apache/maka/discussions/3411)）。NexNote 直接复用 dugite-native 产物即可继承其分发来源与版本对应关系，再在安装包内附 GPL 文本 + 源码链接（git-for-windows / git 源码地址）即可。
- 备注：libgit2 的 linking exception 只适用于「链接 libgit2 库」，**不覆盖**捆绑 git 二进制的场景；GPL 合规义务不因选 libgit2 路线而消失（若仍捆绑 git 作远端用途）。

### 2.3 桌面应用先例

| 应用 | 做法 | 来源 |
|---|---|---|
| VS Code | **不捆绑** git；使用系统安装的 git（要求 ≥ 2.0.0），仅支持官方 Git 分发（明确忽略 GitHub Desktop 附带的 git）；`git.path` 可覆盖 | [Source control in VS Code](https://code.visualstudio.com/docs/sourcecontrol/overview)、[FAQ](https://github.com/microsoft/vscode-docs/blob/c775dd9b/docs/sourcecontrol/faq.md) |
| GitHub Desktop | **始终捆绑**（dugite/dugite-native），刻意不依赖系统 git 以获得已知版本行为；dugite 本体 MIT | [dugite](https://github.com/desktop/dugite)、[dugite issue #182](https://github.com/desktop/dugite/issues/182) |
| Obsidian Git（插件） | **桌面要求系统 git**（submodule 等仅桌面）；移动端因无法用原生 git 被迫用 isomorphic-git，受限严重 | [obsidian-git](https://github.com/Vinzent03/obsidian-git) |

NexNote 的「优先用户 git → 回退捆绑」是 **VS Code 模式（探测 + 覆盖）与 GitHub Desktop 模式（内置兜底）的合体**，无先例风险：探测逻辑可参照 VS Code 的多路径查找实现（[`extensions/git/src/git.ts`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts)）。

### 2.4 两条桌面壳路线的落地方式

- **Electron**：git 分发拷入 `extraResources`，Node 侧 `simple-git` `.customBinary()` 指向它。先例：maka（#3411）。
- **Tauri**：官方 sidecar 机制（`bundle.externalBin`，按 target triple 命名，[Tauri docs](https://v2.tauri.app/develop/sidecar/)）。已知坑：NSIS 安装器重装/升级时 externalBin sidecar 可能不被替换，静默保留旧版 git（[tauri #15134](https://github.com/tauri-apps/tauri/issues/15134)）→ 捆绑 git 的更新策略需要显式处理（版本号校验 + 首启校验）。

### 2.5 捆绑产物选择建议

直接消费 **dugite-native** 的 release 资产（三平台齐、版本跟进官方 git、含 GCM/证书、有 GitHub Desktop 生产验证），而不是自建 MinGit 打包链——把「跟版本、打补丁、修许可文件」的维护成本外包给活跃项目，符合单人过滤器。注意 dugite 面向应用内分发的定位（「not intended for end users to install」正合需求）。

---

## 3. 单篇文档的版本历史与回滚

### 3.1 `git log --follow -- <file>` 可行性与局限（一手来源）

- 官方文档：`--follow` 「works only for a single file」，且对非线性历史（merge）效果不佳；`log.follow` 配置同此限制（[git-log docs](https://git-scm.com/docs/git-log)）。
- rename 追踪是**启发式**（基于相似度），且 `--follow` 在 **merge commit 内部的 rename 会漏追踪**（git blame 能追到而 log --follow 不能，官方补丁讨论仍在进行，[public-inbox 线程](https://public-inbox.org/git/20260522054312.GD861761@coredump.intra.peff.net/t/)）。
- 历史简化相关选项（`--simplify-merges` 等）在大仓库上可能需要全量走历史才返回结果（git-log docs 性能警告）。

**判定：可行且够用**——NexNote 是单文件按需查询（打开某页面的历史面板才跑），个人 vault 提交量（数千~数万）下毫秒~百毫秒级；局限（merge 内 rename 漏检、启发式误判）对笔记场景影响小，UI 上把 rename 前历史标注「可能不完整」即可兜底。

### 3.2 历史与回滚的命令面

```bash
# 单篇历史（按需）
git log --follow --format='%H|%at|%an|%s' -- <path>
# 某版本内容 / 两版本差异
git show <rev>:<path>
git diff <rev1> <rev2> -- <path>
# 文件级回滚（非破坏性：恢复旧内容后再自动提交）
git restore --source=<rev> -- <path>   # git >= 2.23
# hunk 级回滚（交互挑选）
git checkout -p <rev> -- <path>
# hunk 级回滚（程序化：反向应用差异）
git diff <rev> HEAD -- <path> | git apply -R
```

（命令均为 git 官方文档语义：[git-log](https://git-scm.com/docs/git-log)、[git-restore](https://git-scm.com/docs/git-restore)、[git-checkout](https://git-scm.com/docs/git-checkout)、[git-apply](https://git-scm.com/docs/git-apply)）

### 3.3 块级 vs 文件级回滚取舍

- **文件级**：实现最简单、语义无歧义、与 git 真值一一对应。单篇 Markdown 笔记体量小，绝大多数回滚意图就是「回到那天那版」→ MVP 默认。
- **hunk 级**：`git apply -R` 反向应用选中的 diff hunk，可实现「撤销最近这次改动中的某几段」。注意 frontmatter、列表嵌套、表格等块可能被拆进多个 hunk 或多个块挤进一个 hunk——hunk 与「块」只是**近似对齐**（Markdown 段落与 diff 行聚簇高度相关，可用 `-U`/interhunk 参数调聚簇粒度，git apply 支持 `--unidiff-zero` 等边界处理）。
- **块级（git 语义层）**：为每个块单独回滚需要在 git 之上自建结构化 diff/patch 层（块 ↔ hunk 映射、部分应用冲突处理），实现与测试成本高。**建议定位：块级回滚是编辑器 UX 层的「hunk → 块」呈现映射，git 底座只提供 hunk 级原语**，不在 git 语义层发明块级提交。

---

## 4. 自动提交策略

### 4.1 先例做法

| 产品 | 策略 | 来源 |
|---|---|---|
| Obsidian Git | 定时「commit-and-sync」（commit→pull→push 一体）；`autoSaveInterval` 默认 0（关），用户开分钟级间隔；自动提交消息模板 `vault backup: {{date}}`；支持拆分 commit 与 push/pull 定时器；启动自动 pull | [constants.ts](https://github.com/Vinzent03/obsidian-git/blob/4ec375fa/src/constants.ts)、[README](https://github.com/Vinzent03/obsidian-git) |
| VS Code | **不做自动 commit**；`git.enableSmartCommit`（无暂存变更时一键 commit all，默认关）；`git.autofetch` 默认 false、`autofetchPeriod` 默认 180s | [vscode-docs](https://code.visualstudio.com/docs/sourcecontrol/overview)、[defaultSettings 引用](https://stackoverflow.com/questions/77828851/)、[#34684](https://github.com/microsoft/vscode/issues/34684) |

VS Code 将 autofetch 从默认开改为关的原因值得引以为鉴：**自动网络操作触发凭证弹窗骚扰用户**（#34684）→ NexNote 的自动 fetch/push 应默认关或仅在用户配置远端后开启，本地自动 commit 无此问题。

### 4.2 推荐策略（融合先例 + 笔记场景）

1. **变更检测**：应用内编辑器保存事件（精确、免轮询）为主；外部改动（用户在别的编辑器改 vault）用文件系统 watcher + 节流后的 `git status --porcelain=v2`。NexNote 是笔记库非 monorepo，`git status` 常规开销可忽略；若未来库巨大，git 2.37+ 内置 `fsmonitor--daemon`（平台 FS 通知 + IPC）可把大 worktree 的 status 降到亚秒（[GitHub Blog](https://github.blog/engineering/infrastructure/improve-git-monorepo-performance-with-a-file-system-monitor/)、[git-fsmonitor--daemon docs](https://git-scm.com/docs/git-fsmonitor--daemon)），还有 `core.untrackedCache`。
2. **commit 粒度/频率**：双层——（a）idle/debounce 聚合：编辑停止 N 秒（如 10–30s）或失焦时把积攒变更打一个 commit，消息用模板（含时间戳与变更页面列表）；（b）兜底定时器：如每 10 分钟扫一次（对齐 Obsidian Git 用户的常见配置习惯）+ 应用退出时 flush。避免「每键一 commit」。
3. **提交消息**：机器可读格式（如 `chore(vault): auto backup 2026-09-05T14:30 +3 files`），便于置信度统计时把自动提交与手动提交区分权重。
4. **远端操作与本地提交解耦**：自动 commit 永远安全（纯本地）；push/pull 仅用户显式配置远端且选择开启后定时执行（Obsidian Git 的 commit-and-sync 拆分定时器是同款思路）。

---

## 5. 置信度数据源（修改频次 / 更新时间 / 最近修订）

### 5.1 命令面与开销

| 目标 | 命令 | 开销 |
|---|---|---|
| 全库每文件修改频次（一趟批量） | `git log --name-status --format='%H|%at'` → 解析出 (commit, timestamp, files) 聚合 | O(全部提交)；个人 vault（万级提交、万级文件）秒级一趟 |
| 增量维护 | `git log <last_seen_ref>..HEAD --name-status --format='%H|%at'` | O(新提交)；每次 commit 后跑，近零成本 |
| 单文件提交数（无 rename 追踪） | `git rev-list --count HEAD -- <path>` | O(历史) 但单命令快 |
| 单文件最近修订时间 | `git log -1 --format=%at -- <path>` | 同上 |
| 行级 churn（可选权重因子） | `git log --numstat -- <path>` | O(该文件历史) |
| 单文件完整历史（UI 按需） | `git log --follow --format='%H %at' -- <path>` | 见 §3.1 |

社区佐证：churn 分析的常用配方即 `git log --name-only --pretty=format: | sort | uniq -c`（[tomzx analyze-git-churn skill](https://github.com/tomzx/agents/blob/main/skills/analyze-git-churn/SKILL.md)）；**逐文件循环跑 `git log` 在大仓库上不可行**——1.2 万文件需数分钟（[sroccaserra/analyze-repository 实测注明](https://git.sr.ht/~sroccaserra/analyze-repository)）→ 必须批量一趟 + 增量 + 本地缓存。

### 5.2 关键设计结论

1. **批量一趟 + 增量**：首次打开 vault 跑一趟全历史 `--name-status`，结果落到 NexNote 的关系索引库（本地索引）；此后每次自动/手动 commit 后跑增量区间。置信度计算读索引，零 git 调用。
2. **不依赖 `--follow` 做统计**：`--follow` 一次只能跟一个文件（git-log docs），无法批量；重命名在统计口径里按「新文件」处理（或在检测到 rename 事件时迁移/重置分数），只在 UI 单文件历史面板按需使用 `--follow`。
3. **区分自动/手动提交**：自动提交的修改频次应降权（否则「挂着不关的 app 会把所有页面刷成高置信」），靠 §4.2 的机器可读消息格式或 commit 元数据（committer/消息前缀）过滤。
4. `git blame`（逐行溯源）对置信度是杀鸡用牛刀，且大文件慢；仅当未来做「块级最后修订人/时间」展示时按需启用。

---

## 6. 建议路线（供 08 号技术架构票引用）

### 推荐案（默认）

1. **Git 引擎 = simple-git spawn 真实 git CLI**（Electron 与 Tauri 均适用；Tauri 下从 Rust 或经 shell 插件 spawn 皆可）。
2. **git 来源策略 = 探测优先 + 捆绑回退 + 显式覆盖**：启动时按 VS Code 式多路径探测系统 git 并校验版本（建议基线 ≥ 2.23，因 `git restore`；≥ 2.37 可选用 fsmonitor），不合格/缺失则用内置便携 git；设置项允许用户强制指定。simple-git 的 `.customBinary(gitPath)` 承接切换。
3. **捆绑产物 = dugite-native release 资产**（Electron: extraResources；Tauri: sidecar externalBin + 重装替换风险处理），随附 GPLv2 文本 + 源码 offer（复用 SOURCE_OFFER 模式）。
4. **历史/回滚**：单篇历史按需 `git log --follow`；回滚 MVP = 文件级（`git restore --source` + 自动提交）+ hunk 级（`git apply -R`）；块级只做编辑器 UX 映射，不做 git 语义层。
5. **自动提交**：保存事件 debounce（10–30s idle）聚合 + 定时兜底（默认如 10min，可关）+ 退出/失焦 flush；消息机器可读；push/pull 与 commit 解耦、默认关。
6. **置信度管道**：一趟全历史 `--name-status` 建索引 + commit 后增量；统计不依赖 `--follow`；自动提交降权。

### 备选与放弃理由

- **备选（仅当 Tauri 定案且实测 status 高频读成为瓶颈）**：git2-rs 进程内做 status/diff/blame 高频读加速，git CLI 保留全部写与远端操作。双引擎维护面 ×2，仅在性能证据出现后考虑。
- **放弃 isomorphic-git 作为主引擎**：无 SSH / 无协议 v2 / 无 rebase merge / 无 submodule / 内存与大库性能限制，Obsidian Git 移动端实测「very unstable」。保留价值：未来若做移动端，可复刻 Obsidian Git 的 GitManager provider 模式把它当受限 fallback。
- **放弃 gitoxide 作为主引擎**：push/ssh://、merge/rebase/checkout 编排未完成（crate-status.md），2026-09 仍不可自持；作为观察项，其读路径 API 成熟后可在 Tauri 侧替换 git2-rs 备选案。
- **放弃 nodegit**（Electron 场景）：维护停滞 + 原生模块安装痛苦。

## 7. 风险清单

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | GPLv2 合规：捆绑 git 属 GPL 作品传达 | 法务/分发 | 随附 GPL 文本 + 源码 offer（SOURCE_OFFER 模式，GitHub Desktop 先例）；进程隔离保证主程序不传染；发布流程加检查项 |
| R2 | 安装包膨胀（压缩 25–45 MB，解压最多 ~141 MB/平台） | 下载转化、磁盘 | 按平台只带一份；优先用户系统 git（多数用户已有 → 捆绑仅兜底）；评估 macOS 触发公证/体积策略 |
| R3 | 系统 git 探测歧义（多 git 共存：PATH/GitHub Desktop/MSYS2…版本陈旧） | 功能异常难排查 | VS Code 大量 issue 教训（[#7361](https://github.com/microsoft/vscode/issues/7361)、[#87102](https://github.com/microsoft/vscode/issues/87102)）：多路径探测 + 版本/能力校验 + 显式 `git.path` 覆盖 + 诊断面板展示「当前用的是哪个 git」 |
| R4 | Tauri NSIS 重装不替换 sidecar（tauri#15134） | 静默运行旧 git | 首启校验捆绑 git 版本号，不一致则修复/提示 |
| R5 | `--follow` 局限（merge 内 rename 漏检、仅单文件、启发式） | 历史面板偶发缺漏 | UI 标注「rename 前历史可能不完整」；提供不带 --follow 的完整路径历史视图兜底 |
| R6 | hunk 与块不对齐（frontmatter/嵌套列表跨 hunk） | 块级回滚 UX 瑕疵 | 块级只做 UX 映射不做语义承诺；diff 上下文参数调优；提供文件级回滚兜底 |
| R7 | 自动网络操作（fetch/push）触发凭证弹窗骚扰 | 用户体验 | VS Code #34684 教训：默认关，仅配置远端且显式开启后才定时 |
| R8 | 自动提交刷高置信度 | 置信度失真 | 机器可读消息格式 + 统计降权（§5.2） |
| R9 | 大 vault 全历史首趟索引耗时 | 首开体验 | 一趟批量（禁逐文件循环）；后台进行 + 进度提示；之后增量 |
| R10 | dugite-native / simple-git 上游停更 | 供应链 | simple-git 12M 周下载、dugite 有 GitHub Desktop 依赖；均为活跃项目，风险低；捆绑资产可自托管镜像 |

---

## 来源总表（一手）

- simple-git: https://github.com/steveukx/git-js · https://www.npmjs.org/package/simple-git
- isomorphic-git: https://github.com/isomorphic-git/isomorphic-git · FAQ https://github.com/isomorphic-git/isomorphic-git/blob/main/docs/faq.md · SSH issue https://github.com/isomorphic-git/isomorphic-git/issues/231 · 大库冻结 https://github.com/isomorphic-git/isomorphic-git/issues/292
- gitoxide: https://github.com/GitoxideLabs/gitoxide · crate-status https://github.com/GitoxideLabs/gitoxide/blob/main/crate-status.md · 2025-01 进展 https://github.com/GitoxideLabs/gitoxide/discussions/1791
- libgit2: https://libgit2.org/ · https://github.com/libgit2/libgit2/blob/main/README.md
- nodegit: https://github.com/nodegit/nodegit · 维护讨论 https://github.com/nodegit/nodegit/issues/2002
- MinGit: https://gitforwindows.org/mingit.html · release 资产 https://github.com/git-for-windows/git/releases/tag/v2.53.0.windows.4
- dugite / dugite-native: https://github.com/desktop/dugite · https://github.com/desktop/dugite-native · LICENSE https://github.com/desktop/dugite-native/blob/main/LICENSE.md · issue #182 https://github.com/desktop/dugite/issues/182
- 捆绑体积实测（141MB / SOURCE_OFFER）: https://github.com/apache/maka/discussions/3411
- VS Code git 集成: https://code.visualstudio.com/docs/sourcecontrol/overview · FAQ https://github.com/microsoft/vscode-docs/blob/c775dd9b/docs/sourcecontrol/faq.md · 探测实现 https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts · autofetch 默认值讨论 https://github.com/microsoft/vscode/issues/34684
- Obsidian Git: https://github.com/Vinzent03/obsidian-git · 默认值 https://github.com/Vinzent03/obsidian-git/blob/4ec375fa/src/constants.ts · Getting Started https://github.com/Vinzent03/obsidian-git/blob/master/docs/Getting%20Started.md
- git 官方文档: git-log https://git-scm.com/docs/git-log · git-restore https://git-scm.com/docs/git-restore · git-apply https://git-scm.com/docs/git-apply · git-fsmonitor--daemon https://git-scm.com/docs/git-fsmonitor--daemon
- fsmonitor 性能: https://github.blog/engineering/infrastructure/improve-git-monorepo-performance-with-a-file-system-monitor/
- Tauri sidecar: https://v2.tauri.app/develop/sidecar/ · NSIS sidecar bug https://github.com/tauri-apps/tauri/issues/15134
- churn 工具与开销: https://github.com/tomzx/agents/blob/main/skills/analyze-git-churn/SKILL.md · https://git.sr.ht/~sroccaserra/analyze-repository
