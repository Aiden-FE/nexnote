# 15 · MVP 开发任务票据切分

Type: task
Status: resolved
Blocked by: 07, 09, 10, 14
Resolved: 2025

## Question

把产品架构（07）、技术架构终局（08+14）、AI 架构（09）、插件 & Skill 架构（10）与唯一认可原型，切分为 MVP 开发任务票据：

1. 新建开发 effort 目录（如 `.scratch/nexnote-build/issues/`），按模块内聚切票（全模块、一次性大交付，无里程碑门，但票据间标注依赖序）。
2. 每张开发票据关联认可原型中对应的界面 / 交互区域链接，以及相关决策票据链接。
3. 产出票据清单 + 依赖图 + 建议动工顺序（首票 = 编辑器内核骨架）。

本票关闭即抵达目的地：地图完成，开发执行移出本地图。

## Answer

MVP 开发票据切分完成。共 19 张开发票，分 7 个模块，依赖关系清晰，首票 = DEV-001 项目骨架。

### 产出物

- 开发票据目录：`.scratch/nexnote-build/issues/`（共 19 张）
- 票据清单 + 依赖图 + 动工顺序：`.scratch/nexnote-build/README.md`

### 模块划分

| 模块 | 票据数 | 核心票 |
|---|---|---|
| foundation 基础架构 | 3 | DEV-001 项目骨架 |
| editor 编辑器内核 | 3 | DEV-002 TipTap 内核（含 round-trip spike） |
| knowledge 知识关系 | 3 | DEV-004 关系索引 + FTS5 |
| git Git 底座 | 2 | DEV-007 自动提交 + 时间线 |
| ai AI 层 | 4 | DEV-009 Provider Adapter / DEV-011 召回管道 |
| plugins 插件 & Skill | 3 | DEV-013 沙箱运行时 |
| integration 集成 | 1 | DEV-019 E2E 验收 + 打磨 |

### 关键决策

- 首票从项目骨架（DEV-001）起步，编辑器内核（DEV-002）紧随其后。
- **强制 spike 验证**：DEV-002 含 TipTap 3 Markdown round-trip 保真验证，不达标则切换 Milkdown（依据 08 号票备选条件）。
- Git 底座（DEV-007）与 AI Provider（DEV-009）可与编辑器并行推进，加速整体进度。
- 插件系统（DEV-013/014）工作量最大（XL），但不阻塞核心功能路径，可错峰安排。
- DEV-018 打包发布全期并行，不占功能开发节奏。
- 全模块一次性大交付，DEV-019 作最终集成验收关。
