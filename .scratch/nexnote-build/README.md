# NexNote MVP · 开发票据清单

> 来源：15 号票据切分（[nexnote-mvp#15](../nexnote-mvp/issues/15-dev-ticket-slicing.md)）
> 认可原型：[A 案 · 块编辑优先](../nexnote-mvp/docs/research/prototypes/a-block-first.html)
> 技术栈：Electron + React + TS + TailwindCSS/shadcn/ui + TipTap 3 + SQLite + simple-git(dugite)

## 模块总览

| 模块 | 票据 | 说明 |
|---|---|---|
| **foundation** 基础架构 | DEV-001, DEV-016, DEV-018 | 工程骨架、Electron、设置、打包发布 |
| **editor** 编辑器内核 | DEV-002, DEV-003, DEV-017 | TipTap 内核、文件管理、交互细节 |
| **knowledge** 知识关系 | DEV-004, DEV-005, DEV-006 | 索引、双链、frontmatter、图谱 |
| **git** Git 底座 | DEV-007, DEV-008 | 自动提交、时间线、置信度 |
| **ai** AI 层 | DEV-009, DEV-010, DEV-011, DEV-012 | Provider、写作辅助、召回、对话 |
| **plugins** 插件 & Skill | DEV-013, DEV-014, DEV-015 | 运行时、扩展点、内置插件 |
| **integration** 集成验收 | DEV-019 | 联调、打磨、发布 |

## 票据清单（按建议动工顺序）

### P0 · 核心骨架（首批发动）

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 |
|---|---|---|---|---|---|
| **DEV-001** | [项目骨架与 Electron 主进程](issues/001-project-bootstrap.md) | foundation | M | — | A |
| **DEV-002** | [编辑器内核骨架（TipTap 3 + Markdown 双向）](issues/002-editor-kernel-skeleton.md) | editor | L | DEV-001 | B |
| **DEV-003** | [页面树、文件管理与基础侧栏](issues/003-page-tree-sidebar.md) | editor | M | DEV-001 | B |
| **DEV-007** | [Git 底座：自动提交与版本时间线](issues/007-git-foundation.md) | git | L | DEV-001 | B |
| **DEV-009** | [AI Provider Adapter 与配置系统](issues/009-ai-provider-adapter.md) | ai | M | DEV-001 | B |

### P0 · 核心功能（第二批，依赖骨架）

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 |
|---|---|---|---|---|---|
| **DEV-004** | [关系索引（Link Index + FTS5 + 标签）](issues/004-link-index-fts.md) | knowledge | L | DEV-002, DEV-003 | C |
| **DEV-010** | [AI 写作辅助（三入口 + diff 回写）](issues/010-ai-writing-assistant.md) | ai | L | DEV-002, DEV-009 | C |
| **DEV-011** | [渐进式召回管道与向量索引](issues/011-retrieval-pipeline-vector.md) | ai | L | DEV-004, DEV-009 | D |
| **DEV-012** | [AI 对话 dock 与会话即页面](issues/012-ai-chat-dock.md) | ai | L | DEV-009, DEV-011 | E |

### P1 · 功能完善（第三批）

| # | 标题 | 模块 | 工作量 | 依赖 | 并行组 |
|---|---|---|---|---|---|
| **DEV-005** | [元数据：frontmatter 双模式与属性面板](issues/005-frontmatter-properties.md) | knowledge | M | DEV-002 | C |
| **DEV-006** | [图谱视图（全局 + 局部）](issues/006-graph-view.md) | knowledge | M | DEV-004 | D |
| **DEV-008** | [置信度计算引擎](issues/008-confidence-engine.md) | git | M | DEV-004, DEV-007 | D |
| **DEV-013** | [插件系统基础：沙箱运行时与能力 RPC](issues/013-plugin-runtime.md) | plugins | XL | DEV-001, DEV-002 | C |
| **DEV-014** | [插件扩展点 + Skill 系统](issues/014-plugin-extensions-skill.md) | plugins | L | DEV-013 | D |
| **DEV-015** | [内置示范插件：Mermaid + KaTeX](issues/015-builtin-plugins-mermaid-katex.md) | plugins | M | DEV-014 | E |
| **DEV-016** | [设置系统与首启动向导完善](issues/016-settings-onboarding.md) | foundation | M | DEV-001 | B→C |
| **DEV-017** | [编辑器高级交互](issues/017-editor-interactions.md) | editor | M | DEV-002 | C |
| **DEV-018** | [打包、自动更新与发布流程](issues/018-packaging-updates-ci.md) | foundation | M | DEV-001 | 全期并行 |

### P0 · 集成验收（最后）

| # | 标题 | 模块 | 工作量 | 依赖 |
|---|---|---|---|---|
| **DEV-019** | [端到端验收与打磨](issues/019-e2e-polish.md) | integration | L | 全部 P0 + P1 主要票 |

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

## 动工建议

1. **第一轮（Week 1-2）**：DEV-001 打底 → 并行启动 DEV-002 / DEV-003 / DEV-007 / DEV-009 / DEV-016 / DEV-018
2. **第二轮（Week 3-4）**：DEV-004 / DEV-005 / DEV-010 / DEV-013 / DEV-017 并进
3. **第三轮（Week 5-6）**：DEV-006 / DEV-008 / DEV-011 / DEV-014 并进
4. **第四轮（Week 7）**：DEV-012 / DEV-015 + 零散功能收尾
5. **第五轮（Week 8-9）**：DEV-019 集成验收 + 打磨 + 发布

> 注：单人 + AI 结对节奏，预估 8-10 周。插件系统（DEV-013/014）工作量最大（XL），可酌情将 QuickJS worker 等 stretch 项后移到 post-MVP。
