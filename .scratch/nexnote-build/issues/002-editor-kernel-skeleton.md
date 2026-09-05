# DEV-002 · 编辑器内核骨架（TipTap 3 + Markdown 双向）

Type: dev
Module: editor
Status: open
Blocked by: DEV-001
Depends: DEV-001
Effort: L
Priority: P0

## Scope

搭建 TipTap 3 编辑器内核（框架无关包 `packages/kernel`），打通 Markdown ↔ 块模型双向转换，验证 Obsidian 方言 round-trip 保真度。**本票含强制 spike 验证**：若 round-trip 保达不到阈值，切换 Milkdown 路线（依据 [nexnote-mvp#08 备选条件](../../nexnote-mvp/issues/08-tech-architecture.md)）。

### 交付内容
1. **TipTap 3 内核包**
   - 框架无关的编辑器工厂函数（createEditor），接收 DOM 容器 + 配置
   - 核心扩展集：StarterKit 子集 + TaskList + Table + CodeBlockLowlight + Blockquote + Callout（自定义）+ Image + HorizontalRule
   - UniqueID 扩展：每个块分配稳定 ID，写入 `^id` 锚点铬点（Obsidian 兼容）
   - DragHandle 扩展：块左侧拖拽手柄
   - Suggestion / 斜杠菜单扩展骨架

2. **Markdown 双向管道**
   - 基于 `@tiptap/markdown` 扩展 Obsidian 方言支持：wikilink `[[title|alias]]`、`^id` 锚点、callout `> [!note]`、内联 `#tag`、frontmatter
   - serialize（编辑器状态 → MD）+ parse（MD → 编辑器状态）双向
   - **Round-trip spike 验证矩阵**：标题/列表/任务/表格/代码块/引用/callout/图片/链接/wikilink/标签/frontmatter/^id/分隔线/粗体/斜体/行内代码/删除线
   - 阈值：CommonMark+GFM 100% 保真；Obsidian 方言 95%+ 无损（callout 类型、wikilink 别名、^id 锚点均 round-trip 不丢）
   - 不达标则启动 Milkdown 切换预案（新开票）

3. **块 ID 与事务**
   - 块 ID 持久化策略：生成 → 写入 `^id` → 解析时提取 → 重新分配给对应节点
   - 编辑器事务基础：历史记录（undo/redo）、协作预留（不实现，仅留 revision 字段接口）
   - 保存防抖：编辑 → 防抖 N ms → 序列化写文件

4. **渲染层集成**
   - React 组件封装（`EditorView`），桥接主题 CSS 变量与 TipTap 样式
   - 与 Tab 系统集成：打开 .md 文件 = 创建 EditorView
   - 标题同步：文件名 ↔ H1 标题联动（默认绑定，高级设置可解耦，本票先做绑定）

## 关联决策
- 编辑器内核选型：[editor-kernel.md](../../nexnote-mvp/docs/research/editor-kernel.md)
- 竞品块模型与存储：[competitor-arch.md](../../nexnote-mvp/docs/research/competitor-arch.md)
- TipTap 3 为默认、Milkdown 为切换备选：[nexnote-mvp#08](../../nexnote-mvp/issues/08-tech-architecture.md)

## 关联原型区域
- 中央编辑器主体、块手柄、斜杠菜单 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（编辑器区）

## 验收标准
- 空 vault 中可新建 .md 页面并编辑，内容保存后重新打开一致
- Round-trip 验证矩阵中 CommonMark+GFM 项 100% 通过
- Obsidian 方言项 ≥ 95% 通过（callout、wikilink、^id、frontmatter 不丢失）
- 块拖拽可重排，保存后重开顺序一致
- undo/redo 正常工作
- 文件名与 H1 标题双向联动
