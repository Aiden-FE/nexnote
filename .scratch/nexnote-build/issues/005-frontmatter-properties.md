# DEV-005 · 元数据：frontmatter 双模式与属性面板

Type: dev
Module: knowledge
Status: open
Blocked by: DEV-002
Depends: DEV-002
Effort: M
Priority: P1
Parallel-with: DEV-004

## Scope

实现 frontmatter 的属性表格 UI ↔ YAML 源码双模式编辑，以及文档属性侧栏面板（含置信度展示位）。

### 交付内容
1. **frontmatter 解析与序列化**
   - YAML 解析/序列化（js-yaml 或同类）
   - 与 TipTap 编辑器集成：frontmatter 作为节点属性或独立编辑器区域
   - 标准字段：title, tags, aliases, created, updated, type (普通/chat), 置信度字段（置信度本身由 DEV-008 计算）
   - 自定义字段：任意 key-value，支持 string / number / boolean / date / list 类型

2. **属性表格 UI 模式**
   - 在编辑器顶部以表格形式展示 frontmatter 字段
   - 可添加/删除/重命名字段
   - 不同类型有不同编辑器（文本框/数字框/开关/日期选择器/标签输入）
   - tags 字段 = 标签输入器（自动补全已有标签 + 新建）
   - aliases 字段 = 多值文本输入

3. **YAML 源码模式**
   - 切换按钮：属性表格 ↔ YAML 源码
   - 源码模式 = 代码编辑器（语法高亮 + 基本校验）
   - 切换时保持数据一致，解析失败时停在源码模式并标红

4. **文档属性面板**
   - 右侧栏或侧栏的「属性」页签
   - 展示当前页面的全部 frontmatter 字段
   - 置信度展示位：分数 + 构成因子列表（因子值由 DEV-008 Git 底座提供，本票先做 UI 占位 + mock 数据）
   - 入链/出链计数（接 DEV-004 索引）
   - 字数 / 块数统计
   - 创建时间 / 更新时间
   - 文件路径 + 在 Finder 中显示

5. **与索引联动**
   - frontmatter 变更 → 触发 DEV-004 的增量索引更新
   - 标签变更实时反映到标签面板

## 关联决策
- 元数据双模式：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 置信度呈现位置（仅属性面板）：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 编辑器顶部 frontmatter 表格 / YAML 切换、右侧属性面板 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（编辑器顶部 + 右侧面板）

## 验收标准
- 属性表格与 YAML 模式切换数据一致
- 修改 frontmatter 后保存，重新打开不变形
- 自定义字段的各种类型编辑正常
- 标签输入支持自动补全 + 新建
- 文档属性面板展示正确的入链/出链数、字数等
