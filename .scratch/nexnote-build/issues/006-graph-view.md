# DEV-006 · 图谱视图（全局 + 局部）

Type: dev
Module: knowledge
Status: open
Blocked by: DEV-004
Depends: DEV-004
Effort: M
Priority: P1

## Scope

实现知识图谱可视化：全局图谱（独立视图）+ 局部图谱（当前页面 1-2 跳，侧栏面板）。图谱渲染库选型：React Flow（默认候选，本票验证）。

### 交付内容
1. **图谱渲染库选型验证**
   - React Flow 作为默认候选，验证：千级节点性能、力导向布局、自定义节点样式、交互事件
   - 若性能或定制化不达标，评估备选（D3.js force + 自定义 SVG / Sigma.js / G6）
   - 选型结论写入本票 Answer

2. **全局图谱视图**
   - 独立 Tab 视图（从侧栏入口或 ⌘K 打开）
   - 力导向布局：节点 = 页面，边 = 双链
   - 节点大小 = 入度（被引用次数）
   - 节点颜色：无（不映射置信度，产品决策）
   - 过滤：按标签 / 文件夹过滤节点
   - 交互：拖拽节点、悬停显示标题、点击跳转页面、缩放/平移
   - 高亮：选中节点高亮 + 邻边高亮
   - 孤立节点可选显示/隐藏

3. **局部图谱面板**
   - 侧栏面板（与回链/标签并列的页签）
   - 当前页面为中心，1-2 跳邻居
   - 可调整跳数（1 / 2）
   - 点击节点跳转对应页面
   - 悬停显示页面标题 + 入链/出链数

4. **数据接入**
   - 从 Link Index（DEV-004）读取节点和边
   - 索引更新时图谱增量更新（或防抖重绘）
   - 支持大数据量：千级节点流畅交互（WebGL / Canvas 降级方案预留）

## 关联决策
- 图谱全局 + 局部都进 MVP：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 置信度不映射图谱颜色：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 图谱渲染库默认候选 React Flow：[nexnote-mvp#08](../../nexnote-mvp/issues/08-tech-architecture.md)

## 关联原型区域
- 侧栏图谱页签（局部）、全局图谱视图 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（左侧栏图谱页签）

## 验收标准
- 全局图谱展示所有页面及其链接关系
- 500 节点 / 2000 边规模下交互流畅（FPS ≥ 30）
- 局部图谱随当前页面切换实时更新
- 点击节点正确跳转到对应页面
- 标签/文件夹过滤正常工作

## Answer

**选型结论：采用 React Flow 12（`@xyflow/react`）。**

- 数据面：`LinkIndexService.graph()` 一次 SQL 快照返回页面、文件夹、标签、入度/出度和去重有向边，renderer 端再做过滤、局部 N 跳收缩和确定性布局，避免真实大索引下逐页 N+1。
- 性能验证：production Electron smoke 注入 500 页 / 2000 条已解析链接；全局 fitView 下连续 62 次 wheel 缩放实测 **69.0 FPS**，超过 30 FPS 验收线。已启用 `onlyRenderVisibleElements`，并保留确定性 O(n²) 布局的迭代上限。
- 交互验证：节点拖拽/缩放/平移、hover title、点击跳页、标签/文件夹子树过滤、孤立页面开关、选中邻接高亮、局部 1→2 跳实时更新均通过。
- 结论：500 节点量级无需迁移 D3/Sigma/G6；DEV-019 如做千级以上真实数据回归，可再评估 Canvas/WebGL 降级，但当前票据不需要。
