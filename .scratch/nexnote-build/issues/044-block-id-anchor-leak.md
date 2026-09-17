# DEV-044 · 块 ID 锚点泄漏正文修复（aonubg8xf 类随机 ID）

Type: dev
Module: editor
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-002（编辑器内核）
Effort: M
Priority: P0

## Scope

块文档编辑后关闭、再次打开，内容区出现非预期随机字符串（用户实测样本 `aonubg8xf`）。根因已用内核真实管道复现实证：

1. StarterKit trailingNode 产生的文档末尾空段落被 UniqueID 分配 blockId；
2. 序列化时对空段落追加带**前导空格**的占位符，最终落盘为 ` ^id` 独立锚点行；
3. 重新解析时该行被 Markdown 词法按 **lazy continuation** 吸收为前一 taskItem 的续段（taskItem/listItem 无表格那样的专门防御）；
4. 占位符提升要求"文本节点末尾"条件不满足，提升失败——随机 blockId 与 PUA 字符（`\uFFF0/\uFFF1`）成为可见正文，且再次保存后扩散。

修复必须是机制级：序列化侧不得产出会被列表/引用等 lazy continuation 吸收的独立锚点行（空尾段锚点特殊处理或不分配），解析侧对已被吸收的锚点文本做确定性回收与 PUA 清理；**禁止把修复实现为过滤 `aonubg8xf` 等样本字符串**。

## 安全不变量（继承全局约束）

- 关闭重开前后正文语义一致；任何内部随机值、占位值、PUA 字符不得出现在正文或落盘文件中；用户合法输入的同形文本必须原样保留。
- 不改变无待办/无尾空段文档的既有字节保真语义（打开→保存不产生多余差异）。
- 未真实运行的 GUI 验收标 `NOT_RUN`。

## 验收标准

功能：

1. 单测（kernel）：`taskList（内嵌 blockId）+ 文档末尾空 paragraph（blockId）` 经 serialize→parse 往返，JSON 中不得出现任何文本形态的 ID 或 `\uFFF0/\uFFF1`，空尾段不得被并入 taskItem。
2. 单测（kernel）：`- [ ] 待办内容 ^id1\n\n ^id2` 直接 parse：`id2` 必须成为独立块属性或被确定性剥离，不得进入任何 text 节点。
3. 集成：真实 `createEditor`（含 trailingNode + UniqueID）打开"任务列表为最后一块"的文档，编辑 → flush → destroy → 重开，`doc.textContent` 不含生成的 blockId；保存文件中锚点数量不随重开次数增长。
4. 通用不变量测试：编辑→关闭→重开后正文不出现任何非用户输入的随机串/PUA；用户手工输入 `^aonubg8xf` 字样的正文保留不误删。
5. 既有 round-trip / 锚点 / 顺序稳定性测试全部不回归，并扩展覆盖本 case。

门禁（候选 SHA 上执行并留证）：

6. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`git diff --check master...HEAD`。
7. Electron smoke 全绿，扩展关闭重开场景：断言重开后正文与保存文件无生成 ID/PUA 泄漏。

流程：

8. 在 `.wt/DEV-044` / `dev/DEV-044` 隔离实现；双轴审查（Spec 轴对照上文不变量逐条）PASS 后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- 术语：[CONTEXT.md](../../../CONTEXT.md) 块（Block）/ 块编辑模式（Block Editing Mode）
- 相关先例：表格锚点防御（kernel code-table 的独立锚点处理）；块 ID 由 `^锚点` 形式持久化
