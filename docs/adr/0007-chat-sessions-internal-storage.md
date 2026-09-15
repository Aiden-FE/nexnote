---
status: accepted
---

# AI 会话内部化存储于 .nexnote/sessions

AI 对话会话不再是知识库页面：不写入 `AI Chats/` 等普通目录、不出现在左侧文档树、不参与双链与语义索引。会话以 JSONL 形式存储在知识库内部目录 `.nexnote/sessions/{hash}.txt`，`{hash}` 由会话 id 派生且终生不变；文件名不承载标题，标题等元数据在 JSONL 记录内维护。会话历史列表由 Chat Dock 内部提供（含搜索），点击载入续聊；「导出为页面」是会话进入页面体系的唯一路径，导出产物是普通文档，与会话脱钩。

`.nexnote/` 整体不随 Git 版本管理（沿用 ADR-0003 的 ignore 策略，仅 config.json/layout.json 显式保留），会话因此是本机内部数据。当前无存量用户与数据，不做迁移；「会话即页面」的旧实现（`type: chat` 页面、可配置 chatFolder、双链拦截打开 dock）直接移除。

## Consequences

- chat-service 的页面化持久化模型废弃，历史列表改为枚举 sessions 目录；语义索引、反链、双链不再覆盖会话内容。
- 会话重命名不改变文件名；同一会话续聊追加 JSONL 行，流式回复的增量持久化与未完成状态标记（ADR-0005）在 JSONL 记录内表达。
- 导出为页面后页面与会话各自独立演化，不承诺双向同步。
- 换设备不会带走会话数据；若未来需要跨设备会话，须另立决策。
