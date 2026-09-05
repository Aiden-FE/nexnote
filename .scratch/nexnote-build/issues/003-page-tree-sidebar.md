# DEV-003 · 页面树、文件管理与基础侧栏

Type: dev
Module: editor
Status: open
Blocked by DEV-001
Depends: DEV-001
Effort: M
Priority: P0
Parallel-with: DEV-002

## Scope

实现 vault 内文件系统导航、页面树侧栏、文件操作（新建/重命名/删除/移动），以及标签/回链面板的占位与基础数据结构。本票聚焦「文件即页面」的组织模型，编辑器集成（DEV-002）可并行。

### 交付内容
1. **页面树侧栏**
   - 基于 vault 文件夹的树形视图（文件夹 → .md 文件）
   - 过滤：非 .md 文件默认隐藏（可设显示）；`.nexnote/`、`.git/` 始终隐藏
   - 交互：点击打开（新 tab 或激活已有）、右键菜单（新建笔记/文件夹/重命名/删除/在 Finder 中显示）
   - 折叠/展开状态记忆（存 vault 配置）
   - 拖拽移动文件/文件夹（同 vault 内）
   - 搜索过滤：在侧栏顶部输入实时过滤树节点

2. **文件操作内核（主进程）**
   - 新建笔记：生成 .md 文件 + 默认 frontmatter（创建时间 + id）
   - 新建文件夹
   - 重命名：文件重命名 + 全库双链更新（同 vault 内 `[[旧名]]` → `[[新名]]`，后续 DEV-004 索引完成后再做精确替换，本票先做简单字符串替换）
   - 删除：移至系统回收站（优先）或 .trash 目录
   - 移动：拖入文件夹 = 移动文件 + 更新相对路径的链接（基础版）
   - 文件监视：chokidar 监听 vault 变化，推送 IPC 事件刷新 UI

3. **标签面板（基础版）**
   - 扫描 frontmatter tags + 内联 `#tag`，聚合标签列表
   - 点击标签 → 过滤页面树（或打开搜索）
   - 本票用简单文件扫描实现，DEV-004 关系索引完成后升级为索引驱动

4. **反向链接面板（占位）**
   - UI 骨架 + 假数据
   - DEV-004 索引完成后接入真实数据

5. **面包屑与标题栏**
   - Tab 标题 = 页面标题（H1 或文件名）
   - 面包屑：vault 根 > 文件夹 > 页面
   - Tab 右键菜单：关闭/关闭其他/关闭右侧/在 Finder 中显示/复制路径

## 关联决策
- 信息架构（vault → 页面 → 块）：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 文件名 ↔ 标题绑定：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 左侧页面树、标签页签、回链面板 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（左侧栏）

## 验收标准
- 页面树与 vault 文件系统实时同步（外部创建/删除文件也能反映）
- 新建/重命名/删除/移动操作正常，重命名后同 vault 内 wikilink 基本更新
- 标签面板正确聚合 vault 内所有标签
- 侧栏可折叠、宽度可调
