# DEV-012 · AI 对话 dock 与会话即页面

Type: dev
Module: ai
Status: open
Blocked by: DEV-009, DEV-011
Depends: DEV-009, DEV-011
Effort: L
Priority: P0

## Scope

实现右侧 AI 对话 dock：对话界面、上下文注入选择器、会话存储（会话即页面）、会话续聊、保存为文档。

### 交付内容
1. **对话 dock UI**
   - 右侧可折叠面板（宽度可调）
   - 消息列表：用户消息 + AI 回答（流式显示）
   - 输入框：多行输入 + ⌘Enter 发送
   - 顶部工具栏：新会话 / 会话切换 / 设置
   - 空态：未配置 AI → 引导；已配置 → 欢迎 + 使用提示

2. **上下文注入选择器**
   - 输入框上方的 context chips
   - 默认包含：当前文档（自动）
   - 可手动添加 / 移除：当前选区、反向链接文档、特定页面
   - 点击 chip 查看详情，可移除
   - 上下文总 token 估算与超限提示

3. **会话即页面**
   - 每个会话 = 一个 .md 文件（`type: chat` frontmatter + 消息块）
   - 消息块格式：用户消息 vs AI 回答用块属性区分（如 callout 或自定义块）
   - 会话元数据存 frontmatter：profile、model、参数、创建时间
   - 会话存储位置：可配置（默认 `.nexnote/chats/` 或 `AI Chats/` 文件夹）
   - 自动保存：每条消息后保存
   - 会话列表：dock 中可切换历史会话

4. **续聊与引用**
   - 打开历史会话 → 自动加载上下文 → 继续对话
   - 会话页面可被双链引用（`[[会话标题]]`）
   - 从其他页面引用的会话，点击打开对话 dock 并加载该会话

5. **保存为文档**
   - 「保存为文档」按钮：将会话转换为普通页面
   - 转换规则：AI 回答转为正文块，用户消息转为引用或注释（可配置）
   - 保存后在当前 tab 打开
   - 原会话保留（或询问是否删除）

6. **召回来源展示**
   - 每个 AI 回答下方「参考来源」折叠区
   - 列出本次回答用到的上下文块（接 DEV-011 召回管道）
   - 展示：页面标题、块摘要、相似度、置信度
   - 点击跳转到对应页面的对应块
   - 可展开查看三阶段召回的命中数与耗时（调试模式）

7. **与写作辅助联动**
   - 对话中的 AI 回答可「插入编辑器」（DEV-010 已覆盖插入能力，本票做对话侧触发）
   - 选区文字 → 右键「询问 AI」→ 在对话 dock 中打开，自动带入选区作为上下文

## 关联决策
- 会话即页面（type: chat）：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)
- 对话 dock + 上下文注入：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 召回透明：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 右侧对话 dock、上下文 chips、参考来源、会话列表 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（右侧对话 dock）

## 验收标准
- 对话 dock 可展开/折叠，宽度可调
- 可发起新对话，AI 回答流式显示
- 上下文 chips 正确反映当前注入的文档/选区
- 会话自动保存，重启应用后可续聊
- 会话页面在文件系统中为 .md，可被双链引用
- 「保存为文档」可将会话转为普通页面
- AI 回答下方展示参考来源，点击可跳转
- 从选区「询问 AI」可带上下文打开对话
