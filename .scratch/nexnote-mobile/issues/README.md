# NexNote 手机端 · 开发票据清单

> 来源：[手机端对齐地图](../map.md)（grilling + domain-modeling 四轮对齐）
> 决策记录：ADR-0017（Flutter 独立客户端）、ADR-0018（设备端 Git 窄口径）、ADR-0019（数据与能力本地化）
> 术语：`CONTEXT.md` 的 桌面端 / 手机端 / 基础编辑 / 设备端同步 / 快速捕获 / 捕获目录 / 设备知识库 / 设备本地索引

## 当前状态

- 票据总数 **10**，全部 `open`，尚未动工。
- frontier = 本目录中 `open`、依赖已 resolved、未 claimed 的票据；当前 frontier = **MOB-001**。
- 分支约定：`dev/MOB-xxx`；单票据单分支，合并前不并行改同一文件。
- 硬约束：**桌面端零改动**（不新增 HTTP/WS API、不改 IPC 契约）；跨端只共享行为语义。
- 降级闸门在 **MOB-002**：真机设备端 Git 不可行则降级半独立并重开对齐。

## 票据清单（按动工顺序）

| # | 标题 | 里程碑 | 依赖 | 工作量 |
|---|---|---|---|---|
| **MOB-001** | [Flutter 工程与 iOS 签名基线](001-flutter-project-and-signing.md) | M1 | — | M |
| **MOB-002** | [git2dart 真机可行性验证（降级闸门）](002-git2dart-device-spike.md) | M1 | MOB-001 | M |
| **MOB-003** | [设备知识库与存储层](003-device-vault-storage.md) | M1/M2 | MOB-002 | M |
| **MOB-004** | [设备端 Git 服务层与同步编排](004-device-git-service.md) | M1 | MOB-002, MOB-003 | XL |
| **MOB-005** | [阅读侧与页面渲染](005-reader-and-page-render.md) | M2 | MOB-003 | L |
| **MOB-006** | [设备本地索引与中文搜索](006-device-index-and-search.md) | M2 | MOB-003 | L |
| **MOB-007** | [基础编辑：源码模式与块模型](007-basic-editing.md) | M3 | MOB-004, MOB-005 | XL |
| **MOB-008** | [编辑模式切换与零漂移验收](008-mode-switch-and-roundtrip.md) | M3 | MOB-007 | M |
| **MOB-009** | [快速捕获与捕获目录](009-quick-capture.md) | M4 | MOB-004 | S |
| **MOB-010** | [只读 AI 对话与 iOS Keychain 密钥](010-readonly-ai-chat.md) | M4 | MOB-004, MOB-006 | L |

## 里程碑映射

- **M1 · 设备端 Git 垂直切片**：MOB-001 → MOB-002 →（MOB-003、MOB-004）
- **M2 · 阅读与搜索**：MOB-003 →（MOB-005、MOB-006）
- **M3 · 基础编辑**：MOB-007 → MOB-008
- **M4 · 快速捕获与只读 AI**：MOB-009、MOB-010
