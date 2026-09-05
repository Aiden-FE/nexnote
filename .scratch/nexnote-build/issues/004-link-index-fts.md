# DEV-004 · 关系索引（Link Index + FTS5 + 标签）

Type: dev
Module: knowledge
Status: open
Blocked by: DEV-002, DEV-003
Depends: DEV-002, DEV-003
Effort: L
Priority: P0

## Scope

建立 SQLite 单库索引层（Link Index 关系表 + FTS5 全文索引 + 标签索引），作为知识关系、搜索、AI 召回的基础设施。索引为派生缓存，可从 vault 全量重建。

### 交付内容
1. **SQLite 索引库**
   - 主进程侧 better-sqlite3（同步 API，简单可靠）
   - 数据库位置：`.nexnote/index.db`
   - 版本化 schema + migration 机制
   - 全量重建 CLI / 命令（从 vault 扫描所有 .md 文件）

2. **Link Index 关系表**
   - pages 表：id, path, title, aliases, created_at, updated_at, hash
   - links 表：source_page_id, target_page_id (nullable), target_raw, link_type (wiki/normal), anchor (nullable)
   - tags 表：page_id, tag_name, tag_path (for nested tags)
   - blocks 表：page_id, block_id (`^id`), block_type, content_text, position
   - 索引：路径唯一索引、链接双向索引、标签索引、块 ID 索引

3. **索引构建与增量更新**
   - 全量重建：扫描所有 .md → 解析 frontmatter + 正文 → 提取链接/标签/块 → 写入 DB
   - 增量更新：监听文件变化（DEV-003 的 chokidar）→ 单文件重索引
   - 防抖合并：短时间内多次变化合并为一次索引
   - 索引状态：状态栏显示索引进度 / 完成

4. **双链解析与解析器**
   - Wikilink 解析：`[[title]]`、`[[title|alias]]`、`[[title#heading]]`、`[[title#^block-id]]`
   - 标题/别名解析优先级：alias > title > 文件名
   - 未创建页面（红链）：target_page_id = null，但仍记录链接
   - 解析逻辑与 DEV-002 编辑器内核共享（统一工具函数放 shared/kernel 包）

5. **反向链接面板（真实数据）**
   - 接入 Link Index，显示当前页面的所有反向链接
   - 分组：直接链接 / 提及（未解析的文本匹配？MVP 不做文本提及，仅显式链接）
   - 点击跳转 + 上下文预览（悬停显示所在段落）

6. **FTS5 全文搜索**
   - SQLite FTS5 虚拟表：页面标题 + 别名 + 标签 + 块内容
   - ⌘⇧F 全文搜索面板：输入 → 实时结果 → 分块高亮
   - 搜索结果排序：标题匹配 > 标签匹配 > 块内容匹配
   - ⌘K 命令面板接入页面跳转搜索（标题/别名模糊匹配）

7. **标签面板（升级）**
   - 从索引读标签列表 + 计数
   - 点击标签 → 搜索结果页（所有含该标签的页面）
   - 标签树（嵌套标签用 `/` 分隔）

## 关联决策
- 关系索引为派生缓存：[competitor-arch.md](../../nexnote-mvp/docs/research/competitor-arch.md)
- Link Index + FTS5 + sqlite-vec 共库：[nexnote-mvp#08](../../nexnote-mvp/issues/08-tech-architecture.md)
- 双链/别名/标签行为：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 反向链接面板、标签面板、⌘K 搜索、⌘⇧F 全文搜索 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（左侧栏 + 命令面板）

## 验收标准
- 新建带 wikilink 的页面后，反向链接面板实时更新
- 重命名页面后，Link Index 中所有相关链接正确更新
- 全量重建索引后数据与文件系统一致
- FTS5 搜索可按标题/标签/内容命中，响应 < 100ms（千级页面）
- 删除 .nexnote/index.db 后重启可自动全量重建
