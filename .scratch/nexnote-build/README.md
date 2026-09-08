# NexNote MVP · 开发票据清单（执行状态版）

> 来源：15 号票据切分（[nexnote-mvp#15](../nexnote-mvp/issues/15-dev-ticket-slicing.md)）
> 认可原型：[A 案 · 块编辑优先](../nexnote-mvp/docs/research/prototypes/a-block-first.html)
> 技术栈：Electron + React + TS + TailwindCSS/shadcn/ui + TipTap 3 + SQLite + simple-git(dugite)

## 当前状态（2026-09-07）

- 顶层 Goal：**未完成**；全局进度：**17 / 19**（DEV-001 ～ DEV-015 + DEV-017 + DEV-018 已验收并合入 `master`）。
- `master` 当前基线：`abf52c0`（`merge: DEV-018 打包、自动更新与发布流程`）。
- 剩余：DEV-016 🔄（综合修复 agent 处理 blocker/major）、DEV-019 ⏳（依赖全部主要票据，最后执行）。
- 本文件是续接入口；历史执行细节、闸门命令与审查证据见 [`.scratch/DEV-STATUS-CHECKPOINT.md`](../DEV-STATUS-CHECKPOINT.md)。票据需求与验收标准以各 `issues/*.md` 为准。

## 模块总览

| 模块 | 票据 | 状态 | 说明 |
|---|---|---|---|
| **foundation** 基础架构 | DEV-001, DEV-016, DEV-018 | 🔄 进行中 | 工程骨架、打包发布 ✅；设置收尾中 |
| **editor** 编辑器内核 | DEV-002, DEV-003, DEV-017 | ✅ 已完成 | 内核、文件管理、高级交互均已合并 |
| **knowledge** 知识关系 | DEV-004, DEV-005, DEV-006 | ✅ 已完成 | 索引、双链、frontmatter、图谱 |
| **git** Git 底座 | DEV-007, DEV-008 | ✅ 已完成 | 自动提交、时间线、置信度 |
| **ai** AI 层 | DEV-009, DEV-010, DEV-011, DEV-012 | ✅ 已完成 | Provider、写作辅助、召回、对话 |
| **plugins** 插件 & Skill | DEV-013, DEV-014, DEV-015 | ✅ 已完成 | 运行时、扩展点、内置插件 |
| **integration** 集成验收 | DEV-019 | ⏳ 等待依赖 | 联调、打磨、发布（最后） |

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

### P1 · 功能完善（第三批）— 🔄 进行中

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 | 状态 |
|---|---|---|---|---|---|---|
| **DEV-005** | [元数据：frontmatter 双模式与属性面板](issues/005-frontmatter-properties.md) | knowledge | M | DEV-002 | C | ✅ 已合并 |
| **DEV-006** | [图谱视图（全局 + 局部）](issues/006-graph-view.md) | knowledge | M | DEV-004 | D | ✅ 已合并 |
| **DEV-008** | [置信度计算引擎](issues/008-confidence-engine.md) | git | M | DEV-004, DEV-007 | D | ✅ 已合并 |
| **DEV-013** | [插件系统基础：沙箱运行时与能力 RPC](issues/013-plugin-runtime.md) | plugins | XL | DEV-001, DEV-002 | C | ✅ 已合并 |
| **DEV-014** | [插件扩展点 + Skill 系统](issues/014-plugin-extensions-skill.md) | plugins | L | DEV-013 | D | ✅ 已合并 |
| **DEV-015** | [内置示范插件：Mermaid + KaTeX](issues/015-builtin-plugins-mermaid-katex.md) | plugins | M | DEV-014 | E | ✅ 已合并 |
| **DEV-016** | [设置系统与首启动向导完善](issues/016-settings-onboarding.md) | foundation | M | DEV-001 | B→C | 🔄 进行中（旧 WIP `dev/DEV-016@aad90d6` 已过时，需从最新 `master` 新建 fresh worktree 重建） |
| **DEV-017** | [编辑器高级交互](issues/017-editor-interactions.md) | editor | M | DEV-002 | C | ✅ 已合并（`39b239d`，候选 `dev/DEV-017-fresh@f0b2b8a`，双轴审查 PASS） |
| **DEV-018** | [打包、自动更新与发布流程](issues/018-packaging-updates-ci.md) | foundation | M | DEV-001 | 全期并行 | ✅ 已合并（`abf52c0`，候选 `dev/DEV-018@ef905ed`，双轴审查 PASS） |

### P0 · 集成验收（最后）— ⏳ 等待依赖

| # | 标题 | 模块 | 工作量 | 依赖 | 状态 |
|---|---|---|---|---|---|
| **DEV-019** | [端到端验收与打磨](issues/019-e2e-polish.md) | integration | L | 全部 P0 + P1 主要票 | ⏳ 等待 DEV-016/017/018 合并后启动 |

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
2. **再重建 DEV-016**（→ 17/19）：不要 cherry-pick 或直接延续过时 WIP；以最新 `master` 新建 `DEV-016-fresh` 隔离 worktree，实现 8 大设置分类 + 全局/vault 持久化 + 设置搜索 + 快捷键自定义 + 三路径向导（新建 / 打开含 git 与 Obsidian 检测 / 克隆授权预检）与欢迎页，含 opt-in Git init、clone 安全（temp 独占 + atomic move + TTL/revoke）等验收。
3. ~~DEV-018~~ ✅ 已合并（`abf52c0`，→ 17/19）：三平台打包、electron-updater 三通道、release/preflight/nightly CI、durable lease + QA approval gate；N-1 真实网络更新/签名公证/物理安装按规格标 NOT_RUN。
4. **最后执行 DEV-019**（→ 19/19）：以 DEV-016/017/018 全部合并的主线为唯一候选，全量 smoke + E2E + 回归打磨 + 发布清单；配置检查、构建成功、健康探测不等同端到端验证。

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
