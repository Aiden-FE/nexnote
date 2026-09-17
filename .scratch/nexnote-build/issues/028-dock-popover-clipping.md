# DEV-028 · dock 内弹窗遮挡修复

Type: dev
Module: shell
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-012（对话 dock）
Effort: S
Priority: P0

## Scope

对话 dock 内的弹层（Skill 选择器、历史菜单、上下文 chip 详情/添加菜单）目前为普通 absolute 定位，被 dock 面板容器的 `overflow-auto` 裁剪——Skill 菜单向上弹出、空间不足时被完全遮挡；且各弹层 z-index 不一致、与全局 fixed 层（写作浮层、引导 Tour、设置 modal）无统一层级约定。统一弹层挂载与层级策略，任何窗口尺寸下完整可见。

### 交付内容

- dock 内全部弹层经 portal 挂载到不受 overflow 裁剪的容器，锚点定位随触发按钮。
- 空间不足自动翻转方向（上方放不下翻下方，反之亦然）。
- 统一 z-index 层级表：dock 弹层 < 写作浮层 < 引导 Tour < 模态；同层弹层互斥（打开一个关闭其他）。
- 弹层打开时滚动 dock 内容则关闭弹层（不残留错位浮层）。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`。
- 修复仅涉渲染层 UI，不改 IPC 与存储。
- 未真实运行的 GUI 验收标 `NOT_RUN`。

## 验收标准

功能：

1. 窗口任意尺寸、dock 任意高度下，Skill 弹窗完整可见、不被裁剪、不被面板滚动容器剪掉。
2. 弹窗打开时滚动或缩放窗口，弹窗关闭或正确跟随，不残留错位。
3. 与写作浮层、引导 Tour、设置 modal 并存时层级正确，模态始终最高。
4. 键盘可达：Esc 关闭、方向键导航、焦点进入弹层、关闭后焦点归还触发按钮。
5. 历史/chip 菜单同样修复，行为一致。

门禁（候选 SHA 上执行并留证）：

6. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`git diff --check master...HEAD`。
7. Electron smoke 全绿，新增覆盖：dock 最小高度下打开 Skill 弹窗完整可见。

流程：

8. 在 `.wt/DEV-028` / `dev/DEV-028` 隔离实现；双轴审查 PASS 后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- 术语：[CONTEXT.md](../../../CONTEXT.md) 对话 dock（Chat Dock）/ 检索 Skill（Retrieval Skill）
- 先例：浮层定位先查 CSS position/包含块（项目记忆 editor-source-mode-expectation）
