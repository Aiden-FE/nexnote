# DEV-014 · 插件扩展点：块类型、视图、命令、菜单 + Skill 系统

Type: dev
Module: plugins
Status: open
Blocked by: DEV-013
Depends: DEV-013
Effort: L
Priority: P1

## Scope

在插件运行时基础上，实现四类扩展点的完整对接：块类型、视图、命令、菜单。并在此基础上实现检索 Skill 系统（Skill = 受约束的插件）。

### 交付内容
1. **块类型扩展点**
   - 插件可注册自定义块类型：schema + 渲染组件 + 序列化/反序列化
   - 宿主提供 `plugin_block` 占位节点（TipTap 扩展），渲染时委托给对应插件
   - 插件块通过 RPC 与宿主通信（只读 + 编辑事务）
   - 块级能力：可编辑 / 只读 / 可调整大小
   - 示例：Mermaid 块（DEV-015 实现，本票做注册机制 + 测试块）

2. **视图扩展点**
   - 插件可注册自定义视图（侧栏面板 / 主视图 Tab / 设置页）
   - 宿主提供视图容器（iframe 或 WebView）
   - 视图生命周期：mount / unmount / show / hide
   - 视图与宿主通信：通过 capability RPC

3. **命令扩展点**
   - 插件可注册命令（出现在 ⌘K 命令面板中）
   - 命令属性：名称、快捷键（可选）、回调
   - 命令可按插件分组，命令面板可按插件过滤

4. **菜单扩展点**
   - 插件可注册菜单项（编辑器右键菜单 / 块菜单 / 应用菜单）
   - 菜单位置锚点：如 `editor/context/before`、`block/handle/after`
   - 菜单项可见性条件（如选中某类型块时显示）

5. **检索 Skill 系统**
   - Skill = 一类受约束的插件：只能声明检索类能力（`retrieval:*` capability）
   - Skill 接口：注册召回策略（`registerRetrievalStrategy`）
   - 默认内置检索 Skill（DEV-011 的三阶段召回，包装为官方 Skill）
   - 多 Skill 组合：各自召回结果 → 合并 → 统一重排
   - Skill 设置页：启用/禁用、排序、参数配置
   - Skill 贡献的召回策略可在对话面板中切换 / 组合

6. **插件 API 文档与类型定义**
   - 公共 API 的 TypeScript 类型定义（发布为 `@nexnote/plugin-api` 类型包）
   - 插件开发 starter kit（最小插件模板 + README）
   - API 版本号与兼容矩阵（versions.json 模式）

## 关联决策
- 检索 Skill = 受约束的插件：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)
- 四类扩展点：块/视图/命令/菜单：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)
- 多 Skill 组合 = 合并重排：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)
- API semver + 兼容矩阵：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)

## 关联原型区域
- 检索 Skill 抽屉、设置页 Skill 管理 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（Skill 抽屉 + 设置页）

## 验收标准
- 一个第三方测试插件可注册自定义块类型，在编辑器中正常渲染和编辑
- 插件可注册侧栏视图，出现在侧栏页签中
- 插件注册的命令出现在 ⌘K 面板中，可执行
- 插件注册的菜单项出现在右键菜单中
- 可安装一个检索 Skill，在对话面板中切换使用
- 多个检索 Skill 可组合使用，结果合并重排
- 插件类型定义可用，能基于模板创建新插件
