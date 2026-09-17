# DEV-011 · 渐进式召回管道与向量索引

Type: dev
Module: ai
Status: closed
Blocked by: DEV-004, DEV-009
Depends: DEV-004, DEV-009
Effort: L
Priority: P0

## Scope

实现三阶段渐进式召回管道（FTS 粗筛 → 双链扩展 → 向量重排）、sqlite-vec 向量索引构建与增量更新、默认内置检索 Skill 框架。这是 AI 对话上下文注入的核心。

### 交付内容
1. **sqlite-vec 向量索引**
   - 在现有 SQLite 索引库（DEV-004）中增加向量表（使用 sqlite-vec 扩展）
   - 按块粒度建向量索引（块 ID + 向量 + 页面 ID + 块类型）
   - 分代管理：embedding 模型/维度变更 = 新 generation，触发全量重建
   - 增量更新：文件保存/索引更新时，对应块的向量异步更新
   - 后台队列 + 防抖聚合（随自动提交节奏）
   - 状态栏索引进度提示

2. **三阶段召回管道**
   - **阶段一 · 粗筛**：FTS5 全文搜索 + metadata 加权（标题/标签命中权重高），取 Top N（如 50）
   - **阶段二 · 双链扩展**：对粗筛结果的页面，通过 Link Index 扩展 1 跳邻居（入链 + 出链），补充相关页面
   - **阶段三 · 向量重排**：对候选块做 embedding 相似度计算（或近似向量检索），重排顺序；置信度作为乘性加权因子（DEV-008 接口）
   - **Token packing**：按 token 预算从排序结果中选取上下文块，返回给调用方
   - 每阶段结果附带来源标注（用于 UI 展示召回透明）

3. **默认内置检索 Skill**
   - 作为官方检索 Skill 实现（也是插件系统的第一个 Skill，DEV-014 接入）
   - 接口：`search(query, options) => Promise<SearchResult[]>`
   - 可配置参数：topK、阶段开关、置信度权重、token 预算
   - 降级路径：embedding 不可用时自动跳过阶段三（两阶段召回），并在结果中标注

4. **置信度挂钩**
   - 阶段三重排时，每个结果的 score *= confidence_factor
   - confidence_factor 从 DEV-008 的 `getConfidence(pageId)` 获取
   - 权重可配（默认 0.3，即置信度影响 30%）

5. **召回透明 UI**
   - 对话面板中「参考来源」区域
   - 展示本次回答用到的上下文块（页面 + 块摘要 + 相似度/置信度）
   - 可展开查看每个阶段命中数与耗时（调试信息，可选开关）
   - 点击来源跳转到对应页面的对应块

## 关联决策
- 三阶段召回 + sqlite-vec：[ai-vector.md](../../nexnote-mvp/docs/research/ai-vector.md)
- 渐进召回工程位置（内置检索 Skill）：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)
- 置信度乘性重排因子：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)
- 召回透明 UI：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 对话面板参考来源、召回阶段标注 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（对话 dock 参考来源区）

## 验收标准
- 向量索引可从 vault 全量构建，增量更新正常
- 三阶段召回可返回排序结果，每阶段均有命中统计
- 置信度影响最终排序（可通过对比测试验证）
- embedding 不可用时自动降级为两阶段
- 对话面板展示参考来源，点击可跳转
- 千级块规模下，单次召回耗时 < 500ms（含向量检索，参考目标）
