# DEV-015 · 内置示范插件：Mermaid + KaTeX

Type: dev
Module: plugins
Status: closed
Blocked by: DEV-014
Depends: DEV-014
Effort: M
Priority: P1

## Scope

实现两个随包内置的示范插件：Mermaid 图表 + KaTeX 数学公式。它们走完整的插件管线（manifest / 沙箱 / RPC / 能力确认）加载，兼作插件系统 MVP 验收示范。

### 交付内容
1. **Mermaid 插件**
   - 注册自定义块类型：`mermaid`
   - 编辑模式：代码编辑器（输入 Mermaid 语法）
   - 预览模式：渲染 Mermaid 图表
   - 切换：双击编辑 / 失焦预览
   - 支持的图表类型：流程图、时序图、类图、状态图、甘特图（Mermaid 支持的都可用）
   - 块保存为代码块（带 `mermaid` 语言标记），Obsidian 兼容

2. **KaTeX 插件**
   - 注册自定义块类型：`math`（块级公式）
   - 注册行内公式：`math-inline`（行内）
   - 编辑模式：LaTeX 输入
   - 预览模式：KaTeX 渲染
   - 块级保存为 `$$...$$`，行内保存为 `$...$`，Obsidian 兼容

3. **插件打包与分发**
   - 两个插件随应用安装包一起打包
   - 首次启动自动安装（或预安装在系统插件目录）
   - 用户可禁用但不能卸载（内置插件）
   - 走完整的插件加载流程（manifest 解析、能力声明、RPC 通道）

4. **作为插件系统验收用例**
   - 验证块类型扩展点完整可用
   - 验证插件设置页正确显示内置插件
   - 验证能力权限：Mermaid/KaTeX 为纯 UI 插件，无需网络/文件权限
   - 验证插件崩溃不影响主应用

## 关联决策
- 内置示范插件 Mermaid + KaTeX：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)
- 插件管线完整性验证：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)

## 关联原型区域
- 编辑器中的 Mermaid 块、数学公式块 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（编辑器内容区）

## 验收标准
- Mermaid 插件可创建、编辑、渲染流程图等常见图表
- KaTeX 插件支持块级和行内公式，渲染正确
- 两个插件均通过正常插件管线加载（manifest + capability 声明 + RPC）
- 插件设置页中可见内置插件，可禁用/启用
- 禁用后，对应的块类型不再出现在斜杠菜单中
- 保存的文件在 Obsidian 中打开可正确识别为代码块/公式
