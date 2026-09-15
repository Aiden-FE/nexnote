# DEV-043 · 待办 checkbox 垂直对齐修复

Type: dev
Module: editor
Status: open
Blocked by: 无（可立即开始）
Depends: DEV-002（编辑器内核）
Effort: S
Priority: P1

## Scope

块文档中输入 `[ ] 待办内容` 或经斜杠/块菜单创建待办后，checkbox 与文字垂直错位。根因（已调查）：taskList 列表项使用 `align-items: flex-start`，并以 `label { margin-top: 0.2em }` 手工补偿；checkbox 为浏览器原生 input（无 appearance 定制、约 13px 高），在 `--editor-line-height: 1.75` 与可由用户修改的 `--editor-font-size` 下补偿量不成立，错位幅度随字号漂移；预览区 `.nexnote-markdown-preview` 的 taskList 规则缺少 align-items 与 label margin，编辑/预览两态不一致。

### 交付内容

- 建立与字号无关的首行对齐方案：checkbox 视觉中心对齐内容首行行盒中心（自定义 checkbox 盒尺寸/基线方案或按首行行盒计算），替代固定 `margin-top` 补偿。
- 编辑区与预览区共用同一对齐规则，消除两态差异。
- 覆盖未勾选/已勾选、单行/多行待办（对齐以首行为准）、含粗体/链接等行内内容的待办、嵌套待办、自定义字号与主题缩放。

## 安全不变量（继承全局约束）

- 纯渲染层 CSS/结构调整，不改序列化与文件格式；勾选状态与 Markdown round-trip 不回归。
- 未真实运行的 GUI 验收标 `NOT_RUN`。

## 验收标准

功能：

1. checkbox 中心与文字首行行盒中心的垂直偏差 ≤ 2px（默认 16px/1.75 与一档自定义字号下分别断言）。
2. `[ ]` 与 `[x]`、多行待办、行内格式内容、嵌套待办均对齐；多行待办 checkbox 不随换行漂移。
3. 编辑区与 `.nexnote-markdown-preview` 预览区对齐行为一致。
4. 待办勾选/取消勾选的键盘操作与持久化不回归。
5. 几何断言在 smoke/E2E 层实现（DOM 单测布局不可靠）；标准门禁（typecheck、测试、lint、build、diff-check）全绿。

流程：

6. 在 `.wt/DEV-043` / `dev/DEV-043` 隔离实现，双轴审查通过后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- 术语：[CONTEXT.md](../../../CONTEXT.md) 块（Block）/ 块编辑模式（Block Editing Mode）/ 实时预览（Live Preview）
