# DEV-023 · 划词工具栏按钮集统一（格式化 + 双链）

Type: dev
Module: editor
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-010（划词写作辅助）、DEV-020（源码模式）
Effort: M
Priority: P1

## Scope

落实验收反馈「MD 文件也应支持划词工具栏，能够快捷创建符合 Markdown 的语法内容以及 AI 功能」。现状两条独立实现：块编辑 bubble（TipTap）= 格式化五项 + AI 写作六项 + 询问 AI；Markdown 源码 bubble（CodeMirror）= 仅 AI 写作六项 + 询问 AI，**缺格式化**。本票将两种模式的按钮集对齐为同一套，并各自新增「双链」按钮。

### 交付内容

#### 1. Markdown 源码 bubble 补格式化五项

- 按钮与块编辑 bubble 图标、顺序一致：加粗 / 斜体 / 删除线 / 行内代码 / 链接。
- 映射为 Markdown 语法**包裹选区**：`**x**`、`*x*`、`~~x~~`、`` `x` ``、`[x](url)`；链接弹出入 URL 的轻量输入（或粘贴剪贴板 URL，沿用块编辑链接交互既有模式）。
- 无选区时点击插入空语法骨架，光标落在待填位置。
- 写回以**单个 CodeMirror 事务**完成，可一次 undo（与 AI Accept 写回同语义，依据 ADR-0004 修订记录）。

#### 2. 两种 bubble 均新增「双链」按钮

- 插入双链 `[[]]`，与「链接」按钮（外部 URL）在图标与 tooltip 上明确区分。
- 块编辑模式：经内核 wikilink 节点插入（可触发补全）。
- Markdown 源码模式：插入 `[[选区文本]]` 或光标处 `[[页面名]]` 骨架，并触发 DEV-024 的 `[[` 补全（若 024 未合并则仅插入文本骨架，不留硬依赖）。

#### 3. 按钮集最终形态（两种模式一一对应）

格式化五项 + 双链 + AI 写作六项 + 询问 AI。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. `.md` 文档（format=markdown，SourceModeView）划词后工具栏出现完整按钮集：格式化五项 + 双链 + AI 六项 + 询问 AI。
2. 各格式化动作写回的 Markdown 语法正确（含 CRLF 文件），且单次 undo 可整体撤销。
3. 无选区时点击格式化/双链按钮插入骨架并正确定位光标。
4. 块编辑 bubble 出现「双链」按钮，插入的 wikilink 可经 `[[` 补全确认。
5. 双链按钮与外链按钮视觉可区分；既有 AI 动作与询问 AI 不回归。
6. 双格式文档（native-block 与 markdown）在两种编辑面各自按钮集一致。

门禁（全部在候选 SHA 上执行并留证）：

7. `pnpm -r typecheck`
8. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**；新增 md 包裹写回与按钮集断言单测）
9. `pnpm lint`
10. `pnpm build`
11. `node scripts/verify-release-config.mjs`
12. `bash scripts/check-changed-format.sh master`
13. `git diff --check master...HEAD`
14. **Electron smoke e2e 全绿**，且新增覆盖：md 文档划词格式化写回、双链按钮插入、块编辑双链按钮。

流程：

15. 在 `.wt/DEV-023` / `dev/DEV-023` 隔离实现，`master` 不直接编码。
16. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
17. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)「修订（2026-09，划词按钮集统一）」
- 术语定义：[CONTEXT.md](../../../CONTEXT.md) 块编辑模式 / 源码模式 / 双链
