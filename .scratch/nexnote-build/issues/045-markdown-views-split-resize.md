# DEV-045 · Markdown 三视图、分栏拖拽与预览视图

Type: dev
Module: editor
Status: open
Blocked by: 无（可立即开始）
Depends: DEV-020（源码模式视图）、DEV-034（划词按钮集）
Effort: L
Priority: P1

## Scope

按 ADR-0004（2026-09-16 修订）将 `format=markdown` 文档的呈现拆分为三个互斥、tab 临时的 **Markdown 视图**：源码视图（仅 CodeMirror）、分栏视图（源码 + 实时预览，可拖拽分割线）、预览视图（仅只读富渲染，零编辑态）。native-block 文档行为不变（块编辑 + Mod+E 临时原文查看）。

### 交付内容

1. **三视图模型**：tab-store 以 `markdownView: 'source' | 'split' | 'preview'` 取代 `previewVisible`（tab 级临时状态，不持久化）；新开 markdown tab 默认 `split`；关闭 tab 丢弃。
2. **切换入口**：工具栏三态入口（窄窗口整体折叠进溢出菜单）；命令面板三条直达命令（源码/分栏/预览视图）；`Mod+E` = 源码↔分栏（native-block 语义不变）；新增默认绑定 `Mod+Shift+E` = 预览↔最近编辑视图（可改绑）。
3. **分栏拖拽**：复用 `shell/Resizer`（pointer capture + `role="separator"`）；拖拽实时重排；保存相对比例、任一侧最小 20%；双击恢复 50/50；方向键 2%、Shift+方向键 10%；比例仅当前 tab 生命周期内保留（跨视图切换保留、关闭丢弃、新 tab 50/50），不写 vault。
4. **预览视图边界**：隐藏 CodeMirror（实例、光标、undo 栈保留但不挂载可见）、编辑器工具栏的编辑动作、文档属性入口及 Popover、划词工具栏、AI 写作/翻译浮层、快捷插入；工具栏原位常驻**仅含三态切换的极简视图切换器**。保留外壳、文本选择复制、滚动、Mermaid/KaTeX/插件块、查找；预览复用 LivePreview 组件与样式、占满内容区，不做独立阅读排版。
5. **导航与保存语义**：进入预览前 flush，失败停留编辑视图并提示；返回恢复光标与滚动；预览视图内双链/内部链接同 tab 导航且保持预览视图（无 flush，目标以最后保存内容渲染），外链 openExternal 不变；其他入口新开 tab 默认分栏；单纯切换视图不规范化、不改文件字节。

## 安全不变量（继承全局约束）

- 三视图往返（含进入/退出预览）文件字节不变；逐字节保存语义不回归。
- 外部文件变化冲突路径行为与编辑视图一致，不因预览覆盖未保存内容。
- 预览视图不得残留任何编辑态写入路径（无光标、无划词、无属性编辑、无 AI 浮层）。

## 验收标准

功能：

1. 三视图经工具栏/命令面板/快捷键均可切换；`Mod+Shift+E` 从预览返回进入前的编辑视图（源码或分栏）。
2. 拖拽分割线实时重排、比例 clamp 20%–80%、双击重置、键盘 2%/Shift 10%、窗口缩放保持比例、tab 内跨视图保留、关闭 tab 丢弃。
3. 预览视图无任何编辑 affordance（自动化断言 + smoke 截图）；视图切换器可见可达（键盘可聚焦）。
4. 预览视图内 wikilink/内部链接导航后仍为预览视图且无需保存；从文件树/搜索/图谱新开 tab 为分栏。
5. 进入预览前 flush 失败时停留编辑视图；三视图往返字节不变（既有保真测试不回归）。
6. 标准门禁（typecheck、测试、lint、build、diff-check）全绿；新增单测覆盖 store 与切换映射；smoke 覆盖预览视图与拖拽（未真实运行标 `NOT_RUN`）。

流程：

7. 在 `.wt/DEV-045` / `dev/DEV-045` 隔离实现，双轴审查通过后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（2026-09-16 修订）
- 术语：[CONTEXT.md](../../../CONTEXT.md) Markdown 视图 / 源码视图 / 分栏视图 / 预览视图 / 视图切换器 / 实时预览
