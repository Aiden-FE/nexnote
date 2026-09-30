# NexNote 手机端对齐 · Wayfinder 地图

Label: wayfinder:map

## Destination

完成手机端（iOS 优先）第一轮对齐：形态、技术选型、能力边界、同步架构与交付顺序全部定稿并落 ADR，输出可直接切票的 M1–M4 里程碑。开发执行在本地图之外进行。

## Notes

- 语言：与用户交流用简体中文，技术术语保留英文。
- Tracker：本地 markdown（本目录）。票据在 `.scratch/nexnote-mobile/issues/`（MOB-001 ～ MOB-010，全部 open）；frontier = open、依赖已 resolved、未 claimed 的票据，当前为 **MOB-001**。
- 承接：`.scratch/nexnote-mvp/map.md` 把「Web 版与移动端」列为 out of scope 并注明「届时另立新图」，本地图即该新图。
- 硬约束：**桌面端零改动**——不新增 HTTP/WS API、不改 152 条 IPC 契约。跨端只共享行为语义（分词规则、元数据头约定、提交消息前缀 `nexnote:*`），不共享代码。
- 基线约束（对齐固化，作为全部票据的硬输入）：
  - 定位 = 自用为主，架构按可发布设计；桌面端保持完整编辑的唯一权威编辑环境。
  - 形态 = Flutter 独立客户端（iOS 优先），不复用 `packages/renderer` 与 `packages/kernel`。
  - 同步 = 设备端 Git（git2dart / libgit2）窄口径直连同一远程；冲突即禁写并回桌面处理。
  - 数据与能力本地化 = AI 独立 Profile + iOS Keychain + 只读对话；本地 FTS5 索引复刻桌面分词、无向量；设备知识库存 App Support 并排除 iCloud 备份。
  - 分发 = 免费个人团队签名（7 天重签）；转 TestFlight / App Store 为后续项。
  - 人力 = 单人 + AI 结对 → 最高风险假设最先验证。

## Decisions so far

- **定位与范围**：手机端提供阅读、基础编辑与快速捕获，能力为桌面端的精简子集；桌面端承担完整编辑。二进制文档在手机端可见但只读，标注「请在桌面端打开」。术语见 `CONTEXT.md` 的 桌面端 / 手机端 / 基础编辑 / 快速捕获 / 捕获目录。
- **形态选型**：Flutter 独立客户端，理由与被否方案见 `docs/adr/0017-mobile-flutter-client.md`。核心事实：`packages/kernel` 依赖浏览器 DOM，React renderer 与 TipTap 内核在 Dart 侧零复用。
- **同步架构**：设备端 Git 窄口径，理由与三档差距清单见 `docs/adr/0018-mobile-device-side-git-sync.md`。
  - 可平移：init / status / commit / log / fetch / push / lsRemote / clone / remote 管理。
  - 需重写但可等价：pull（fetch + rebase 编排）、autoSync 流水线、ahead/behind、sync guard、restore。
  - 无法等价：credential helper / SSH agent 语义、`format-patch` / `git am`、doctor 的手工 shell 出口。
- **数据与能力本地化**：AI 密钥、搜索索引、设备知识库存放方式见 `docs/adr/0019-mobile-data-and-capability-locality.md`。术语见 `CONTEXT.md` 的 设备端同步 / 设备知识库 / 设备本地索引。
- **基础编辑的两条硬规则**：① 源码编辑与简化块编辑共享同一文档模型，模式切换必须无损，验收线是「桌面端块编辑器重新打开零漂移」；② 块模式遇到不支持的结构原样保留，只能经源码模式编辑，禁止静默改写。
- **搜索一致性要求**：手机端 FTS5 分词必须复刻桌面语义（CJK unigram+bigram + 拉丁前缀，见 `packages/main/src/indexer/index-service.ts`），否则两端搜索结果不一致。
- **技术事实（已查证，2026-09-30）**：git2dart 0.5.6 提供 iOS/Android 预编译二进制（内置 libgit2 + libssh2 + OpenSSL，iOS ≥ 12，MIT）；iOS 需在 Flutter main 中 `PlatformSpecific.initialize()`；vault 只能用 app 私有目录；凭证需经 Dart 层注入，libgit2 不会自行访问 Keychain。最大风险是生态薄——无生产级第三方先例，仅官方 demo。

## v1 能力边界

**进 v1**

- 阅读：页面树、全文搜索（中文）、双链跳转、反向链接面板、标题目录、图谱只读浏览、标签筛选、版本时间线只读
- 编辑：源码编辑；简化块编辑（段落、标题、有序/无序列表、任务列表、引用、代码块、图片）
- 快速捕获：新建页面写入可配置捕获目录，自动补默认元数据头
- AI：独立供应商 Profile + 只读对话，无编辑提案、无写回
- Git：init / status / commit / log / fetch / push / pull（rebase）；离线可编辑可提交，联网后推送
- 置信度只读展示（由桌面端计算并写入元数据头，手机端不重算）

**不进 v1**

- 二进制文档编辑（xlsx / xmind）；frontmatter 编辑
- 表格 / 公式 / 图表块的编辑（只读占位）
- 向量召回、Agent 工具、检索 Skill、插件系统
- doctor 修复流程、`format-patch` 备份、Git 历史操作（restore）
- Android、本地模型 AI、复杂冲突的手动解决

## 里程碑与验收

- **M1 · 设备端 Git 垂直切片（最高风险先验证）**：Flutter 壳 + git2dart 打通真机 clone / 本地 commit / push。验收：真机 clone 一个脱敏 vault 副本，本地提交后 push 到测试远端，桌面端 pull 后历史可见。
- **M2 · 阅读与搜索**：设备知识库落 App Support（排除 iCloud 备份）+ FTS5 索引复刻分词 + 阅读侧 v1 清单。验收：中文搜索结果与桌面端一致（同一查询同一命中集）。
- **M3 · 基础编辑**：先源码编辑、后简化块编辑，共享同一文档模型。验收：手机改过的页面桌面端块编辑器重新打开零漂移；不支持结构在块模式原样保留。
- **M4 · 快速捕获与只读 AI**：捕获目录可配置 + iOS Keychain 密钥 + 只读对话。验收：AI 不可写回页面；离线时 AI 不可用但编辑与提交仍可用。

## 降级闸门

- 若 M1 遇到不可绕过的 git2dart blocker（如 rebase 编排或凭证链路在真机不可用），降级为「半独立」：手机端保留设备知识库可读可编辑可本地提交，push/pull 交由桌面端结算，并重开该分支的对齐。

## 票据清单

切票索引见 `issues/README.md`。

| # | 标题 | 里程碑 | 依赖 |
|---|---|---|---|
| MOB-001 | Flutter 工程与 iOS 签名基线 | M1 | — |
| MOB-002 | git2dart 真机可行性验证（降级闸门） | M1 | MOB-001 |
| MOB-003 | 设备知识库与存储层 | M1/M2 | MOB-002 |
| MOB-004 | 设备端 Git 服务层与同步编排 | M1 | MOB-002, MOB-003 |
| MOB-005 | 阅读侧与页面渲染 | M2 | MOB-003 |
| MOB-006 | 设备本地索引与中文搜索 | M2 | MOB-003 |
| MOB-007 | 基础编辑：源码模式与块模型 | M3 | MOB-004, MOB-005 |
| MOB-008 | 编辑模式切换与零漂移验收 | M3 | MOB-007 |
| MOB-009 | 快速捕获与捕获目录 | M4 | MOB-004 |
| MOB-010 | 只读 AI 对话与 iOS Keychain 密钥 | M4 | MOB-004, MOB-006 |

## Not yet specified

- 触屏交互细则：源码编辑器与块编辑器的手势、无物理键盘时选区工具栏的呈现、命令面板的移动端形态。
- 块模型在 Dart 侧的存储表示与增量解析策略（桌面 TipTap 的 round-trip 保障如何在 Dart 侧复现）。
- 搜索索引的增量更新与全量重建触发条件。
- 移动端与桌面端并发写入的冲突体验（手机禁写提示的具体形态、是否允许手机端解决简单冲突）。
- 7 天重签周期内的开发流程与 TestFlight 切换触发条件。

## 范围外跟进（桌面端问题，与手机端无关）

- `docs/adr/0016-vault-config-layout-out-of-git.md` 记录 `preserve-local-and-abort` 会 `format-patch → abort → git am` 回放，但 `packages/main/src/git/git-service.ts` 当前实现只做导出 + abort（返回 `replayed: 0`），文档与实现不一致。
- `git.autoCommit` 开关、`commitMessageTemplate`、`defaultBranch` 在 `packages/main/src` 内无消费点；`git:recordAutoCommit` 通道无 renderer 调用方。

## Out of scope

- Android 首发（iOS 优先，后续再定）。
- 与桌面端的实时协同编辑。
- 手机端作为自托管主机或云端中继。
- 二进制文档的手机端只读预览。
