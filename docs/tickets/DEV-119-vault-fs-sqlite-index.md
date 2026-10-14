# DEV-119 Vault / FS / SQLite / 索引迁移

- 状态：in progress
- 分类：architecture
- 优先级：P0
- 工作量：XL
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-118、ADR-0003、ADR-0016、ADR-0019

## 背景

Electron 后端的 Vault、页面树、Markdown/sidecar、文件 watcher、better-sqlite3 FTS/Link Index 和置信度索引构成产品数据底座。Tauri 终态需在 Rust 中重建这些能力，同时保持 vault 是事实源、索引可重建、路径安全与现有文件兼容。

## 方案

1. **Vault 状态机**：创建、打开、关闭、recent list、inspect、layout、`.nexnote/config.json` 兼容读写。
2. **文件服务**：路径 canonicalize 与逃逸防御；页面/sidecar/二进制枚举与安全读写；外部修改与 app 写入来源标记；watcher 去抖、重命名/删除、大库扫描。
3. **SQLite**：选择 `rusqlite` 或等价库；明确 FTS5 编译/加载；迁移 schema 与版本；处理事务、备份、锁恢复、崩溃后 WAL；保持关系索引为事实源、派生索引可重建。
4. **索引**：页面/块索引、双链关系、标签/alias、全文搜索、置信度增量计算。
5. 用真实 fixture vault 与大库压力测试对比 Electron 行为。

## 验收标准

- [ ] Electron 可打开的 vault，Tauri 可无损打开并保留配置/layout/sidecar。
- [ ] 创建、打开、关闭、重开、外部修改、删除、重命名、权限错误均有测试。
- [ ] SQLite schema/migration 有版本测试；损坏库 fail closed 且保留原文件。
- [ ] FTS 与 Link Index 结果与既有 fixture 语义一致，大库扫描有进度与取消。
- [ ] 路径逃逸、符号链接、Windows 盘符/大小写、非 UTF-8 名称有测试或登记平台阻塞。
- [ ] macOS 实测；Windows/Linux 文件系统与 GUI 保持 **NOT_RUN（当前无实测条件）**。

## Out of scope

- Git 操作与凭证（DEV-120）。
- AI/向量索引（DEV-121）。
- 二进制编辑器 UI（DEV-123）。
