# DEV-095 文档头 frontmatter 块内 created/updated 展示可读时间

- 状态：done（2026-09-28）
- 分类：bug
- 优先级：P2
- 工作量：S
- 范围：packages/kernel（frontmatter 节点展示）、packages/renderer（样式）
- Depends: DEV-078（面板内可读时间展示，已发布 v0.0.26，本票补其未覆盖的"文档头"surface）
- 来源：用户反馈 2026-09-22 / triage 2026-09-27

## 背景

用户要求文档属性里的 `created` / `updated` 在**文档内**以 `年-月-日 时:分:秒` 呈现；当前文档顶部仍直接显示裸 ISO（如 `2026-09-22T00:21:35.110Z`）。

DEV-078 只覆盖了属性面板的三个展示位（`PropertiesPanel` 时间区、`FrontmatterValueDisplay`、`pageStatistics`），**没有覆盖文档顶部的 frontmatter 块**，所以用户仍能看到裸 ISO。

## 现状（核实）

- 文档顶部渲染的是一个 `frontmatter` 节点（`packages/kernel/src/extensions/frontmatter.ts:24-82`），`renderHTML` 产出 `<pre data-frontmatter class="nexnote-frontmatter"><code class="nexnote-frontmatter-code">`（`:42-52`），内容是**原始 YAML 文本**（`:72-77` 把 `token.yaml` 原样塞进 text 节点）。
- 样式：`packages/renderer/src/globals.css:361-380` 把它渲染成等宽字体、虚线边框的代码块，带 `FRONTMATTER` 角标 —— 即用户所说的"文档头"。
- 该节点注释明确"编辑器内呈现为等宽 YAML 块（code 节点语义），DEV-005 将替换为属性面板"（`frontmatter.ts:9`）——替换尚未发生，所以原始 YAML 一直可见。
- 存储与序列化：`renderMarkdown` 直接回写 `---\n<原文本>\n---`（`:79-81`），`splitFrontmatter`/`renderFrontmatterMarkdown`（`:84-98`）在 kernel 管道外层做 100% 原文保真拆装；`page-source-io` 侧写入时还会 `stampUpdated`。**任何改动必须保持字节往返不变。**
- DEV-078 的 out-of-scope 只写了"YAML 源码模式显示原文"（指 `FrontmatterPanel` 的 YAML 模式），并未把文档头这个 surface 排除，属遗漏而非有意豁免。

## 期望行为

1. 文档顶部 frontmatter 块中，`created` / `updated` 的**展示值**为本地时区 `YYYY-MM-DD HH:mm:ss`（复用 kernel 既有的 `formatDisplayDateTime`），不再出现裸 ISO。
2. **存储与序列化零改动**：写回文件的仍是原始 ISO（含毫秒/Z），YAML 文本与往返字节语义不变（ADR-0004 字节保真）。本票纯展示。
3. 不可解析的值原样显示，不抛错；空值不额外编造内容。
4. 用户仍能编辑该块的 YAML（若本票选择保留原始文本编辑态，则需明确：编辑态显示原文，非编辑态显示可读时间；具体交互由实施者决定，但用户必须能看到可读时间）。

## 关键接口

- `Frontmatter` 节点的展示层（`packages/kernel/src/extensions/frontmatter.ts`）：需要区分**编辑态文本**与**展示态渲染**，或在 NodeView 中按 `created`/`updated` 键做展示替换。
- 展示格式化统一走 kernel 导出的 `formatDisplayDateTime`（`packages/kernel/src/frontmatter/model.ts:424-442`），禁止 renderer 侧散写 `toISOString`/`toLocaleString` 用于展示（沿用 DEV-078 约束）。
- 序列化路径（`renderMarkdown`、kernel markdown 管道、`page-source-io` 的 `stampUpdated`）**不得修改**。

## 验收标准

- [ ] 打开含 `created`/`updated` 的文档，文档头显示为 `YYYY-MM-DD HH:mm:ss`（本地时区），无裸 ISO
- [ ] 保存后文件内 `created`/`updated` 仍为 ISO 原文，往返字节不变（含已有测试的字节保真断言）
- [ ] 无法解析的时间字符串原样展示，不报错
- [ ] 无 `created`/`updated` 的文档头展示不受影响
- [ ] 新增/更新测试覆盖展示格式化与序列化保真两侧
- [ ] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 把 frontmatter 块整体替换为属性面板（DEV-005 的更大改造）
- `FrontmatterPanel` 的 YAML 源码模式（按设计显示原文，归 DEV-078）
- 相对时间（"3 小时前"）与时区配置
