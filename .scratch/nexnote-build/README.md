# NexNote MVP · 开发票据清单（执行状态版）

> 来源：15 号票据切分（[nexnote-mvp#15](../nexnote-mvp/issues/15-dev-ticket-slicing.md)）
> 认可原型：[A 案 · 块编辑优先](../nexnote-mvp/docs/research/prototypes/a-block-first.html)
> 技术栈：Electron + React + TS + TailwindCSS/shadcn/ui + TipTap 3 + SQLite + simple-git(dugite)

## 当前状态（2026-09-14）

- 顶层 Goal：**✅ 已完成**；全局进度：**26 / 26**（DEV-001 ～ DEV-026 全部验收并合入 `master`）。
- `master` 当前发布基线：`1e1ab79`（`merge: verify published release assets`）。
- 发布/自动更新对标切片已完成：产物命名与精确 contract、Ad hoc macOS 签名、无凭据跨平台构建、Updater 平台策略与失败恢复、GitHub Release 发布后 asset 回读校验均已合并。
- 最新 master 门禁：125 个测试文件通过（1 skipped）/ 1012 个测试通过（2 skipped）、typecheck、lint、build、release-config **31/31**、changed-format、diff-check 全绿。无 Apple Developer、Windows Authenticode、Ubuntu GPG 私钥的本机 macOS arm64 发布包已真实构建，产物名为 `NexNote-0.1.0-mac-arm64.{dmg,zip}`，`codesign` 报告 `Signature=adhoc`；打包 Electron smoke **154/154 PASS**，退出码 0。证据见 `.scratch/nexnote-build/smoke/RELEASE-FINAL-3/results.json` 与 `.scratch/nexnote-build/smoke/RELEASE-MAC-ARM64-FINAL/results.json`。
- 全部票据已合入；双轴审查（Standards + Spec）均 PASS；未验证项按协议标注 **NOT_RUN** 并附人工步骤（见 [RELEASE-NOTES](./RELEASE-NOTES.md) 与 [release-checklist](./release-checklist.md) 第 6 节）。
- 本文件是续接入口；历史执行细节、闸门命令与审查证据见 [`.scratch/DEV-STATUS-CHECKPOINT.md`](../DEV-STATUS-CHECKPOINT.md)。票据需求与验收标准以各 `issues/*.md` 为准。

## 模块总览

| 模块 | 票据 | 状态 | 说明 |
|---|---|---|---|
| **foundation** 基础架构 | DEV-001, DEV-016, DEV-018 | ✅ 已完成 | 工程骨架、设置、打包发布均已合并 |
| **editor** 编辑器内核 | DEV-002, DEV-003, DEV-017, **DEV-020** | ✅ 已完成 | 内核、文件管理、高级交互、源码模式均已合并 |
| **knowledge** 知识关系 | DEV-004, DEV-005, DEV-006 | ✅ 已完成 | 索引、双链、frontmatter、图谱 |
| **git** Git 底座 | DEV-007, DEV-008 | ✅ 已完成 | 自动提交、时间线、置信度 |
| **ai** AI 层 | DEV-009, DEV-010, DEV-011, DEV-012 | ✅ 已完成 | Provider、写作辅助、召回、对话 |
| **plugins** 插件 & Skill | DEV-013, DEV-014, DEV-015 | ✅ 已完成 | 运行时、扩展点、内置插件 |
| **integration** 集成验收 | DEV-019 | ✅ 已完成 | E2E 集成、性能时间盒、bug bash、文档、发布准备 |

## 票据清单（按建议动工顺序）

### P0 · 核心骨架（首批发动）— ✅ 已完成

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 | 状态 |
|---|---|---|---|---|---|---|
| **DEV-001** | [项目骨架与 Electron 主进程](issues/001-project-bootstrap.md) | foundation | M | — | A | ✅ 已合并 |
| **DEV-002** | [编辑器内核骨架（TipTap 3 + Markdown 双向）](issues/002-editor-kernel-skeleton.md) | editor | L | DEV-001 | B | ✅ 已合并 |
| **DEV-003** | [页面树、文件管理与基础侧栏](issues/003-page-tree-sidebar.md) | editor | M | DEV-001 | B | ✅ 已合并 |
| **DEV-007** | [Git 底座：自动提交与版本时间线](issues/007-git-foundation.md) | git | L | DEV-001 | B | ✅ 已合并 |
| **DEV-009** | [AI Provider Adapter 与配置系统](issues/009-ai-provider-adapter.md) | ai | M | DEV-001 | B | ✅ 已合并 |

### P0 · 核心功能（第二批，依赖骨架）— ✅ 已完成

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 | 状态 |
|---|---|---|---|---|---|---|
| **DEV-004** | [关系索引（Link Index + FTS5 + 标签）](issues/004-link-index-fts.md) | knowledge | L | DEV-002, DEV-003 | C | ✅ 已合并 |
| **DEV-010** | [AI 写作辅助（三入口 + diff 回写）](issues/010-ai-writing-assistant.md) | ai | L | DEV-002, DEV-009 | C | ✅ 已合并 |
| **DEV-011** | [渐进式召回管道与向量索引](issues/011-retrieval-pipeline-vector.md) | ai | L | DEV-004, DEV-009 | D | ✅ 已合并 |
| **DEV-012** | [AI 对话 dock 与会话即页面](issues/012-ai-chat-dock.md) | ai | L | DEV-009, DEV-011 | E | ✅ 已合并 |

### P1 · 功能完善（第三批）— ✅ 已完成

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 | 状态 |
|---|---|---|---|---|---|---|
| **DEV-005** | [元数据：frontmatter 双模式与属性面板](issues/005-frontmatter-properties.md) | knowledge | M | DEV-002 | C | ✅ 已合并 |
| **DEV-006** | [图谱视图（全局 + 局部）](issues/006-graph-view.md) | knowledge | M | DEV-004 | D | ✅ 已合并 |
| **DEV-008** | [置信度计算引擎](issues/008-confidence-engine.md) | git | M | DEV-004, DEV-007 | D | ✅ 已合并 |
| **DEV-013** | [插件系统基础：沙箱运行时与能力 RPC](issues/013-plugin-runtime.md) | plugins | XL | DEV-001, DEV-002 | C | ✅ 已合并 |
| **DEV-014** | [插件扩展点 + Skill 系统](issues/014-plugin-extensions-skill.md) | plugins | L | DEV-013 | D | ✅ 已合并 |
| **DEV-015** | [内置示范插件：Mermaid + KaTeX](issues/015-builtin-plugins-mermaid-katex.md) | plugins | M | DEV-014 | E | ✅ 已合并 |
| **DEV-016** | [设置系统与首启动向导完善](issues/016-settings-onboarding.md) | foundation | M | DEV-001 | B→C | ✅ 已合并（`68604c4`，候选 `dev/DEV-016-fresh@e9e4f04`，双轴审查 PASS） |
| **DEV-017** | [编辑器高级交互](issues/017-editor-interactions.md) | editor | M | DEV-002 | C | ✅ 已合并（`39b239d`，候选 `dev/DEV-017-fresh@f0b2b8a`，双轴审查 PASS） |
| **DEV-018** | [打包、自动更新与发布流程](issues/018-packaging-updates-ci.md) | foundation | M | DEV-001 | 全期并行 | ✅ 已合并（`abf52c0`，候选 `dev/DEV-018@ef905ed`，双轴审查 PASS） |
| **DEV-020** | [源码模式与单栈编辑器](issues/020-source-mode.md) | editor | L | DEV-002, DEV-005, DEV-015, DEV-017, DEV-019 | 追加 | ✅ 已合并（历史基线） |
| **DEV-021** | [用户文案统一「知识库」并删除文件浏览占位页](issues/021-copy-unify-remove-files-page.md) | shell | M | — | 验收反馈 | ✅ 已合并（`e8a07d3`，候选 `c12d2ad`，smoke 123/123，双轴 PASS） |
| **DEV-022** | [页签拖拽排序与切换快捷键](issues/022-tab-drag-reorder-hotkeys.md) | shell | M | — | 验收反馈 | ✅ 已合并（历史基线 `968290c`，smoke 140/140，双轴 PASS） |
| **DEV-023** | [划词工具栏按钮集统一](issues/023-selection-bubble-parity.md) | editor | M | DEV-010, DEV-020 | 验收反馈 | ✅ 已合并（`2dead70`，候选最终 `63b6b49`，smoke 129/129，双轴 PASS） |
| **DEV-024** | [双链可发现性：Markdown 源码补全与反向链接角标](issues/024-wikilink-discoverability.md) | editor | M | DEV-020 | 验收反馈 | ✅ 已合并（`9d16284`，候选 `4ad2d57`，smoke 145/145，双轴 PASS） |
| **DEV-025** | [文档属性感知：字段目录与 Markdown 属性面板](issues/025-field-catalog-md-properties.md) | editor | L | DEV-020 | 验收反馈 | ✅ 已合并（Popover 修订 `a99babc`，YAML flush 修订 `d8f03f7`，smoke 154/154，双轴 PASS） |
| **DEV-026** | [AI 配置入口收口设置页](issues/026-ai-settings-single-entry.md) | ai | S | DEV-009, DEV-012 | 验收反馈 | ✅ 已合并（`5d49165`，候选 `ab39ba4`，smoke 116/116，双轴 PASS） |

### 新一轮验收反馈（DEV-027～DEV-042）— open

> 处理方式：按 Wave 1～5 分批推进；Wave 内无阻塞票并行，依赖边以各票 `Blocked by` 为准。每票使用独立 worktree/`dev/<TICKET>` 分支，合并前执行标准门禁与 Standards + Spec 双轴审查。

| 波次 | 票据 | 主题 | 阻塞关系 |
|---|---|---|---|
| Wave 1 | DEV-027～031、DEV-034～036、DEV-043～044 | H1 失焦、Skill 弹窗、代码高亮、零隐式请求、SDK 流式迁移、AI 下拉、工具栏、双模式插入、待办对齐、块 ID 泄漏 | 无（可并行） |
| Wave 2 | DEV-032、033、037、041 | SDK 工具循环、会话 JSONL、编辑器流式状态机、临时翻译 | 各自依赖 DEV-031；DEV-037 另依赖 DEV-034 |
| Wave 3 | DEV-038、039 | `/` 快捷插入、Chat Dock 权限模式 | DEV-038 依赖 DEV-035/036/037；DEV-039 依赖 DEV-032/033 |
| Wave 4 | DEV-040 | Agent 编辑工具与审批批次 | DEV-039 |
| Wave 5 | DEV-042 | 端到端集成与打包 smoke | DEV-027～041、DEV-043～044 全部 |

票据明细：DEV-027～DEV-042 位于 [`issues/`](issues/)，需求与验收标准以各票据为准。

### P0 · 集成验收（最后）— ✅ 已完成

| # | 标题 | 模块 | 工作量 | 依赖 | 状态 |
|---|---|---|---|---|---|
| **DEV-019** | [端到端验收与打磨](issues/019-e2e-polish.md) | integration | L | 全部 P0 + P1 主要票 | ✅ 已合并（原交付 `d95fb9e`；GUI follow-up `2af0166`，候选 `849fa83`，双轴审查 PASS） |

## 依赖图

```
DEV-001 (骨架)
├── DEV-002 (编辑器内核)
│   ├── DEV-004 (关系索引) ──────┐
│   ├── DEV-005 (frontmatter)    │
│   ├── DEV-010 (写作辅助)       │
│   └── DEV-017 (编辑器交互)     │
├── DEV-003 (页面树/侧栏)        │
│   └── DEV-004 (关系索引)       │
├── DEV-007 (Git 底座)           │
│   └── DEV-008 (置信度) ────────┤
├── DEV-009 (AI Provider) ───┐   │
│   ├── DEV-010 (写作辅助)   │   │
│   └── DEV-011 (召回管道) ───┼───┤  (DEV-011 依赖 DEV-004 + DEV-009)
│       └── DEV-012 (对话) ──┘   │
├── DEV-013 (插件运行时)         │
│   └── DEV-014 (扩展点+Skill)   │
│       └── DEV-015 (内置插件)   │
├── DEV-016 (设置/向导)          │
└── DEV-018 (打包发布) ← 全期并行 │
                                  │
DEV-006 (图谱) ← DEV-004 ─────────┘
DEV-008 (置信度) ← DEV-004 + DEV-007
                                  │
                                  ▼
                          DEV-019 (E2E 验收)
```

## 续接顺序

1. ~~DEV-017~~ ✅ 已合并（`39b239d`，→ 16/19）：闸门全绿 + fresh Standards/Spec 双轴 PASS（Standards 5 minor / Spec 2 minor，无 blocker/major）。
1. ~~DEV-016~~ ✅ 已合并（`68604c4`，→ 18/19）：8 分类设置 + 全局/vault 持久化 + 搜索 + 快捷键自定义 + 三路径向导（新建/打开/克隆），双轴审查 PASS。
3. ~~DEV-018~~ ✅ 已合并（`abf52c0`，→ 17/19）：三平台打包、electron-updater 三通道、release/preflight/nightly CI、durable lease + QA approval gate；N-1 真实网络更新/签名公证/物理安装按规格标 NOT_RUN。
4. ~~DEV-019~~ ✅ 已合并（`d95fb9e`，→ 19/19）：E2E 纯逻辑集成测试（4 用例，120 页 fixture vault 全链路）、性能时间盒（3 用例，千页/8k 块/3k 链接，实测索引 ~210ms / 搜索 ~8ms / PageRank ~280ms / 图谱 ~90ms）、bug bash 6 个模块交界回归断言、4 份用户文档（user-guide / shortcut-cheatsheet / plugin-development / FAQ）、RELEASE-NOTES + release-checklist（含 NOT_RUN 清单）。双轴审查：Spec @480cd66 PASS（2 minor）、Standards 一审 FAIL（4 major 文档失实）→ 修复 `9c77dba` → 复审 PASS（0 issues）。
5. ~~DEV-020~~ ✅ 已合并（`0f14a49`，→ 20/20）：删除通用双 Pane 分屏，落地 per-tab 源码模式（CodeMirror 6 左侧原文 + 只读 Live Preview 右侧，三入口：头部按钮 / Mod+E / 命令面板；H1↔文件名联动与预览 Wikilink 同 tab 导航保持源码模式；字节保真写盘与外部冲突防护）。首轮候选 `6ce348d` 后修复 6 项 smoke 失败（kernel UniqueID 初始化补 ID 误触发保存 → 打开即归一化写盘；Mermaid tokenizer 不认 `~~~` 围栏；smoke 陈旧 DOM 竞态与场景顺序断言）+ 加固 smoke 退出码假绿（`app.quit()` → `app.exit(code)`，空报告判失败）。双轴审查 @`839baf5`：Standards PASS（1 minor 时序耦合注释建议）、Spec PASS（1–23 PASS，24 为合并后流程）。证据：`smoke/DEV-020/results.json`（打包产物 102/102，退出码 0）。

## 🏁 终局状态（2026-09-14）

- **26 / 26 全部完成并合入 `master`；DEV-021～DEV-026 验收反馈轮已闭环**（文档属性 Popover 修订已合入 `a99babc`，当前代码基线见 master）。
- 最近 master 门禁：typecheck、124 个测试文件通过（1 文件 skip）/ 991 个测试通过（2 skip）、eslint、build、verify-release-config 29/29、changed-format、diff-check 全绿；属性 Popover 修订的打包 macOS arm64 Electron smoke **154/154** 全绿，退出码 0，证据见 `smoke/DEV-025-POPOVER-FINAL3/results.json`。
- 本轮新增票据 smoke 证据：DEV-021 123/123、DEV-022 140/140、DEV-023 129/129、DEV-024 145/145、DEV-025 128/128、DEV-026 116/116，均在候选 SHA 上通过 Standards + Spec 双轴审查后合并。
- 剩余 NOT_RUN 仅为跨平台/外部环境项（完整清单见 [release-checklist 第 6 节](./release-checklist.md)）：三平台签名/公证/物理安装、真实 Obsidian 知识库导入、kill -9 崩溃恢复、打包后冷启动 <3s 实测、大文档流畅度、自动更新端到端等。
- `better-sqlite3` 在 Node/Electron ABI 间切换后已恢复 Node ABI（`pnpm pretest`）。

## 统一验收与合并协议

在票据 worktree 中，先确保候选改动已提交，再至少执行：

```bash
CI=true pnpm -r typecheck
CI=true pnpm test
CI=true pnpm exec eslint .
CI=true pnpm build
git diff --check master...HEAD
```

- 单票据必须隔离实现（`.wt/<TICKET>` / `dev/<TICKET>`），禁止直接在 `master` 编码；不得因存在 WIP 或测试文件就标记完成。
- 对已知的 `main` 包基线 TypeScript 问题、chokidar watch flaky、Electron smoke 既有基线失败，必须在 checkpoint 写明复现证据、影响归属与专项回归结果；不得无证据称通过。
- 闸门通过后，在固定候选 SHA 上做 Standards 与 Spec 双轴复核；均 PASS 后才允许 `git merge --no-ff` 合入 `master`。
- 合并后在 `master` 重跑上述门禁，并更新 [`.scratch/DEV-STATUS-CHECKPOINT.md`](../DEV-STATUS-CHECKPOINT.md) 与本文件中的进度 / 分支基线。
- 真实 Windows 原生安全创建、macOS/Windows/Linux 物理签名与安装、macOS 公证/Gatekeeper、N-1 网络自动更新等当前环境无法验证的项目必须标注 **NOT_RUN** 并附人工验证步骤；不可用单元测试、构建成功或配置文件代替。

## 工作区注意事项

- 主仓：`/Users/aiden/dev/aiden/nexnote`，保持 `master` 干净；其中存在少量既有的未跟踪 smoke 截图（DEV-007/013），除非票据明确要求清理，否则不要删除或纳入提交。
- DEV-017 仅使用 `.wt/DEV-017-fresh`；旧 `.wt/DEV-017`（`506e5f8`）是历史 WIP，勿用。DEV-016 旧 worktree 同理仅供考古。
- Electron smoke 会涉及 `better-sqlite3` 的 Node ABI / Electron ABI 切换（target 44.2.0）；执行 Electron target rebuild 后，必须恢复 Node ABI（备份 `/tmp/better-sqlite3-build-bak/`）才能继续运行 Vitest。
- 当前环境未提供可用的子 Agent 派发能力时，主控可按单票据、单 worktree、单分支的隔离方式接管实现；任何阻塞、降级、豁免和人工前置条件都必须同步记录到 checkpoint。
