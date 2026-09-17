# DEV-029 · 代码块语法高亮补齐

Type: dev
Module: editor
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-002（编辑器内核）、DEV-020（源码模式）
Effort: M
Priority: P0

## Scope

代码块高亮覆盖不足：块编辑与实时预览走 lowlight `common`（35 种语言，缺 Dockerfile、TOML、PowerShell、LaTeX、CMake、HCL/Terraform、Dart、Scala、Haskell 等），源码模式 CodeMirror 围栏内完全没有语言 grammar（只装了 Markdown 语言包，未配置 `codeLanguages`）。要求三处渲染路径覆盖一致，未知语言优雅降级。

### 交付内容

- 块编辑与实时预览：补齐 lowlight 语言注册，纳入主流语言全集；未知/未标注语言降级 `plaintext`，不报错。
- 源码模式：为 Markdown 围栏配置 `codeLanguages`，按需懒加载语言包（如 `@codemirror/language-data`），避免全量静态打包。
- 三处（块渲染、源码围栏、实时预览）使用同一份语言覆盖清单，新增语言只改一处。
- 大代码块（千行级）编辑与预览不引入明显卡顿。

## 安全不变量（继承全局约束）

- 新增依赖需通过既有门禁与打包校验（`verify-release-config`）；渲染层不引入网络请求。
- 高亮渲染不得阻断编辑（沿用预览 debounce 与错误隔离既有语义）。
- 未真实运行的 GUI 验收标 `NOT_RUN`。

## 验收标准

功能：

1. 覆盖清单逐语言在块渲染、源码围栏、实时预览三处高亮结果一致（至少含 common 全集 + Dockerfile、TOML、PowerShell、LaTeX、CMake、HCL、Dart、Scala、Haskell、Elixir）。
2. 未知语言标记（如 ```foo）降级纯文本，无控制台报错。
3. JSX/TSX、Vue、Svelte 等模板语言在支持范围内表现正确或明确列为已知限制。
4. 千行代码块输入、滚动与预览不卡顿。

门禁（候选 SHA 上执行并留证）：

5. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`node scripts/verify-release-config.mjs`；`git diff --check master...HEAD`。
6. Electron smoke 全绿，新增覆盖：代表语言（如 Dockerfile、TOML、PowerShell）在块渲染与源码模式均高亮。

流程：

7. 在 `.wt/DEV-029` / `dev/DEV-029` 隔离实现；双轴审查 PASS 后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- ADR：[0004 源码模式](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（实时预览完整富渲染）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 块（Block）/ 源码模式（Source Mode）/ 实时预览（Live Preview）
