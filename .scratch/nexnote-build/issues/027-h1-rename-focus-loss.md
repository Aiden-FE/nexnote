# DEV-027 · H1 编辑失焦修复

Type: dev
Module: editor
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-020（源码模式）
Effort: M
Priority: P0

## Scope

编辑一级标题触发自动保存与文件改名时，编辑器不得销毁重建。根因已定位：rename 后 `updateTab` 更新 `tab.pagePath`，两个编辑器视图的加载 effect 依赖该值重跑进入 loading 分支，编辑器宿主被从 DOM 移除后重建，焦点、光标、滚动全部丢失（块编辑视图的挂载注释声称「rename 不重挂」，但实现与意图矛盾，属回归点）。要求把 rename 修复为纯元数据更新：路径变化不触发整页重载。

### 交付内容

- 块编辑与源码模式两视图中，rename 引起的 `pagePath` 变化不再进入 loading/重建路径；仅非 rename 的路径切换（打开其他页面）才重载。
- 编辑器内容与磁盘一致时复用现有内核/CodeMirror 实例，只更新路径引用与 tab 元数据。
- 保持 rename 后页面树 `unlink/add`、tab 标题、`displayPath` 同步语义不回归。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，文件读写经既有 IPC。
- 自动保存与改名链路不得触发任何 AI provider 请求（ADR-0005；DEV-030 门禁覆盖）。
- 未真实运行的 GUI 验收标 `NOT_RUN`。

## 验收标准

功能：

1. 块编辑与源码模式改 H1 → 自动保存改名后，焦点保持在编辑器、光标位置不变、滚动位置不变。
2. 连续输入 H1 期间多次改名不闪屏、不重挂、不丢输入。
3. 改名后页面树、tab 标题、路径引用正确同步；「首 H1 ↔ 文件名」双向绑定不回归。
4. 保存失败、外部修改冲突路径行为不回归。

门禁（候选 SHA 上执行并留证）：

5. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`git diff --check master...HEAD`。
6. Electron smoke 全绿，新增覆盖：源码模式与块模式改 H1 后继续输入不断焦。

流程：

7. 在 `.wt/DEV-027` / `dev/DEV-027` 隔离实现，`master` 不直接编码。
8. 固定候选 SHA 上 Standards 与 Spec 双轴审查无 blocker/major 后 `git merge --no-ff`；合并后在 `master` 复跑门禁并更新 README 与 checkpoint。

## 关联决策

- ADR：[0004 源码模式](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（首 H1 ↔ 文件名绑定两模式一致）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 页面（Page）/ 源码模式（Source Mode）
