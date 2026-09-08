# DEV-020 · 源码模式取代通用双 Pane 分屏

Type: dev
Module: editor
Status: open
Blocked by: DEV-019
Depends: DEV-002, DEV-005, DEV-015, DEV-017, DEV-019
Effort: L
Priority: P0

## Scope

依据 [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md) 与 [CONTEXT.md](../../../CONTEXT.md) 术语，一次交付两件事：

1. **彻底移除通用双 Pane 分屏**（旧的第二 tab 栈），
2. **新增按 tab 临时启用的源码模式（Source Mode）**：左侧 CodeMirror 6 编辑 Markdown 原文，右侧只读实时预览（Live Preview）。

默认编辑体验保持不变，仍是块编辑模式（Block Editing Mode）。

### 交付内容

#### 1. 移除通用双 Pane 分屏

- 删除左右双 tab 栈模型：`PaneId`、`panes.left` / `panes.right`、`activePaneId`、`splitEnabled`、`splitRatio`、`toggleSplit`、`setSplitRatio`。
- Tab store 退化为**单 tab 栈**；所有打开页面的调用点不再传 `PaneId`。
- 删除 `SplitView` 的双 Pane 语义与 `split-divider` 分隔线 UI（含双击收起）。
- 删除 `view.toggleSplit` 命令（标题「切换左右分屏」）及其快捷键与 palette 条目。
- 删除布局持久化中的 `splitEnabled` / `splitRatio`（shared 类型、renderer 持久化、main IPC 校验）。
- 删除欢迎页等处引导用户使用左右分屏的文案。
- **不写迁移代码**：旧 vault 配置中遗留的 split 字段读取时忽略，下次布局写回自然消失。

#### 2. 源码模式（Source Mode）

- 仅对 Markdown 页面 tab 可用；是**该 tab 的临时状态**，不持久化到 vault 配置、不按页面记忆、不全局开启；关闭 tab 后恢复块编辑模式。
- 三个切换入口，行为一致：编辑器头部按钮、`Cmd/Ctrl+E`、Command Palette 命令。
- 布局：左侧 CodeMirror 6 源码编辑器（Markdown 语法高亮 + 行号），右侧只读 Live Preview。
- CodeMirror 编辑内容包含**完整原文**，YAML frontmatter 以原始文本出现在源码中；源码模式下隐藏 frontmatter 属性面板。
- 源码模式下不出现块编辑模式专属交互：斜杠菜单、AI 选区浮栏、块右键菜单、拖拽手柄、标题折叠。

#### 3. 实时预览（Live Preview）

- 复用现有编辑器内核以**只读**方式渲染，完整呈现 NexNote 支持的富内容：Mermaid、KaTeX、插件块、Wikilink、代码块等。
- 数据流严格单向：源码 → 预览。不实现预览 → 源码的反向编辑同步。
- 更新采用约 200ms debounce；**复用实例**而非每次输入重建编辑器；异步渲染结果只允许最新版本生效（过期结果不得覆盖新内容）。
- 滚动单向跟随：源码滚动驱动预览滚动；在预览中滚动不反向移动源码。

#### 4. 保存与文件联动

- 源码模式保存**逐字节写回编辑框内容**，不经 TipTap 序列化规范化。
- 接入现有 app-wide save 契约（`registerAppSaveListener` / `requestAppSave`），与 rename / move / delete 的 flush 时序兼容。
- 「首个 H1 ↔ 文件名」绑定在源码模式下与块编辑模式行为一致：源码中改首个 H1 同样触发链接式改名，并同步页面树与 tab 标题。
- 模式切换前先 flush；保存失败时停留原模式并保留内容。**仅切换模式不得触发原文规范化写盘。**

#### 5. 错误、导航与冲突

- 解析或渲染失败**不得阻断**源码编辑与原文保存；局部 Mermaid / 公式 / 插件渲染错误在预览对应位置展示，普通未闭合 Markdown 不得当作整页解析失败。
- 整页解析失败时预览显示明确错误；若保留上一次预览内容，必须标明其已过期。
- 切回块编辑模式时若整页解析失败，则**拒绝切换**并停留在源码模式，保留用户原文。
- 预览中的内部页面链接 / Wikilink 可点击：先保存，成功后在**同一 tab 内导航并保持源码模式**；保存失败则取消导航。
- 外部 URL 不作为 vault 页面加载，沿用应用现有安全打开策略，不因源码模式放宽协议限制。
- 外部文件变化与本地未保存源码冲突时：不自动覆盖任一版本，暂停该路径自动保存，保留本地缓冲区并提示用户选择；无本地修改时可直接重载。判定需基于写入前的版本检查，不得只依赖延迟到达的文件监听事件。

#### 6. Undo / Redo

- CodeMirror 与块编辑器各自维护独立 undo/redo 栈；不承诺跨模式撤销。
- 模式切换后的撤销不得恢复另一页面内容，也不得覆盖已保存原文。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. 全新 vault 与含旧 `splitEnabled: true` 配置的 vault，启动后主区都只有**一个 tab 栈**，无分隔线、无第二 Pane。
2. 代码库中不存在 `PaneId` / `splitEnabled` / `splitRatio` / `toggleSplit` 残留（含 shared 类型、IPC 校验、命令注册、文案）。
3. 三个入口均能在 Markdown 页面 tab 上进出源码模式，且状态一致。
4. 源码模式左侧显示完整原文（含 YAML frontmatter），属性面板隐藏；右侧只读预览渲染 Mermaid、KaTeX、插件块与 Wikilink。
5. 源码模式下不可在预览侧编辑；斜杠菜单、AI 浮栏、块右键菜单、拖拽手柄、标题折叠均不出现。
6. 关闭并重开该 tab 后回到块编辑模式；重启应用不恢复源码模式。
7. 源码中修改首个 H1 并保存后，文件被改名，页面树与 tab 标题同步更新。
8. 预览中点击内部链接 / Wikilink 在同一 tab 导航且仍处于源码模式。

保真：

9. 无编辑地打开 → 保存 → 模式往返，文件字节不变；覆盖 YAML、尾随空行、列表标记、代码围栏、CRLF/LF。
10. 源码模式保存的内容与编辑框文本逐字节一致，未经 Markdown 规范化。

健壮性：

11. 输入未闭合 / 非法 Markdown 时源码仍可编辑与保存，预览展示错误而不崩溃；整页解析失败时切回块编辑模式被拒绝且内容保留。
12. 快速连续输入下预览不出现过期内容覆盖，不为每次按键重建编辑器实例。
13. 存在未保存源码时收到外部文件变化，不静默覆盖，且提示用户选择。

门禁（全部在候选 SHA 上执行并留证）：

14. `pnpm -r typecheck`
15. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**）
16. `pnpm lint`
17. `pnpm build`
18. `node scripts/verify-release-config.mjs`
19. `bash scripts/check-changed-format.sh master`
20. `git diff --check master...HEAD`
21. **Electron smoke e2e 全绿**，且新增覆盖：默认单栏无分隔线、三入口切换、源码原文保真保存、预览富内容渲染、H1 改名同步、预览链接导航、关闭 tab 后模式重置。

流程：

22. 在 `.wt/DEV-020` / `dev/DEV-020` 隔离实现，`master` 不直接编码。
23. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
24. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- [ADR-0004 以源码模式取代通用双 Pane 分屏](../../../docs/adr/0004-source-mode-replaces-split-pane.md)
- 术语定义：[CONTEXT.md](../../../CONTEXT.md) 块编辑模式 / 源码模式 / 实时预览
