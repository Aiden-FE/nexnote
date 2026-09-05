# 14 · 原型评审确认：拍板唯一认可案

Type: grilling
Status: resolved
Blocked by: 11, 12, 13

## Question

用户对比整案原型 A / B / C（各绑定 08 号票圈定的技术栈组合与推荐序），拍板：

1. 选定唯一认可案（产品形态 + UI 基线 + 技术栈组合一并确认）；未认可案的原型产物归档（移动到 docs/research/prototypes/archive/ 或删除，保留链接记录）。
2. 认可案绑定的技术栈组合升级为**最终技术架构决策**，回写 08 号票 Answer 收口（若有出入，以本票为准）。
3. 记录用户在评审中提出的修改意见清单，作为 15 号票切票时对认可原型的增量修正项。

本票关闭即「原型确认」达成；认可原型在 15 号票被关联到开发任务票据。

## Answer

原型评审确认定稿（2025-09-05，用户拍板）：

1. **认可案 = A · 块编辑优先工作台（默认推荐案）**，v0 无修改意见直接采纳；产物（canonical）：docs/research/prototypes/a-block-first.html。
2. **最终技术架构决策**：A 案绑定的默认栈即终局——Electron + React + TS + TailwindCSS/shadcn/ui + TipTap 3（框架无关内核包）+ Obsidian 公开方言 + SQLite 单库（FTS5/Link Index/sqlite-vec）+ 默认捆绑 Git（dugite）+ 凭证/SSH 集成 + 系统 Git 高级回退。与 08 号票定稿一致、无出入；ADR 0001 / 0002 维持 accepted。
3. **未认可案归档**：B（知识网络优先）、C（AI 原生驾驶舱）产物移至 docs/research/prototypes/archive/，票据保持 resolved，不再作为开发基线。
4. **修改意见清单**：无（v0 直接采纳）；15 号票以 A v0 为基线切分开发票据。
5. 11 号票随本票评审结果收口（in-progress → resolved）。
