# DEV-ARCH-002 全面迁移 Tauri 2：Rust product core 总控

- 状态：in progress
- 日期：2026-10-14
- 优先级：P0
- 关联：ADR-0028、ADR-0027、ADR-0001、ADR-0015、ADR-0026、`docs/research/tauri2-migration-assessment.md`

## 背景

用户确认全面迁移 Tauri 2，并围绕 Tauri 2 重新实现产品逻辑；同时确认迁移期间保留 Electron 对照通道、不使用常驻 Node sidecar、先落任务票据再开工。当前仓库主进程约 20,539 行，深度依赖 Electron IPC、dialog、safeStorage、updater、`WebContentsView`、better-sqlite3、simple-git/dugite、chokidar 与 keyring；Renderer 约 35,133 行，已有 shared 类型化 IPC contract 可复用。

## 已确认决策

1. **终态架构**：Tauri 2 + Rust product core；React Renderer 与 shared IPC contract 保留。
2. **无常驻 Node sidecar**：不复用 Electron main 作为后端；外部工具二进制（如 Git）可作为独立 sidecar。
3. **双壳并行**：Electron 保留为对照通道与回退路径，直到 Tauri 全部门槛通过。
4. **先验证最高风险**：优先做 shared contract 盘点、Tauri shell、三 WebView 编辑器矩阵，再迁移核心后端。
5. **内置语义向量**：ADR-0027 独立决策保留，Tauri 实现纳入 AI/召回子票。
6. **平台证据边界**：本机只有 macOS 图形环境；Windows/Linux 真实 GUI、安装、签名与更新验证当前 **NOT_RUN**，不得以构建成功或推理替代。

## 子票与依赖

| 子票 | 主题 | 依赖 | 状态 |
| --- | --- | --- | --- |
| DEV-115 | 迁移契约与命令所有权盘点 | 无 | done |
| DEV-116 | Tauri 2 壳 + Renderer bridge | DEV-115 | done |
| DEV-117 | 三 WebView 编辑器兼容矩阵 | DEV-116 | partial（三平台 release 包启动全绿；块编辑/IME/拖拽/CodeMirror/React Flow/打印预览 fixture 仍 NOT_RUN，见 `docs/tauri/webview-editor-matrix.md`） |
| DEV-118 | Rust product core 基础与状态生命周期 | DEV-115 | done（设置/recent vaults 持久化、原子写、损坏/只读失败路径、启动快照与 macOS dev 实测完成） |
| DEV-119 | Vault / FS / SQLite / 索引迁移 | DEV-118 | partial（核心 FS/SQLite/watcher/index/clone token/取消已测；macOS 真实 GUI 与跨平台文件系统证据仍缺） |
| DEV-120 | Git 运行时与同步体系迁移 | DEV-119 | partial（核心 Git/doctor/bundled Git/超时/取消/GPL 门禁已实现；跨平台 bundled 构建与凭据行为待 CI 补证） |
| DEV-121 | AI、召回与内置语义向量迁移 | DEV-118 | partial（Agent/审批/本地模型下载/代理/断点/进度 UI/召回取消已实现；缺检索质量评测、RSS 门槛、插件 Skill 发现与 Win/Linux ONNX 实测） |
| DEV-122 | 插件沙箱与 capability 迁移 | DEV-116、DEV-118 | partial（安装/权限/审计/session/challenge/RPC 已测；真实沙箱 GUI 与恶意 fixture 全矩阵仍缺） |
| DEV-123 | 二进制编辑器宿主与打印迁移 | DEV-116、DEV-117 | partial（label/flush/sender/resize 与 e2e 协议已测；真实文档 GUI、打印、崩溃隔离与内存未测） |
| DEV-124 | Tauri 更新、签名、发布与 QA | DEV-116 | partial（tauri-v0.0.37.1 已发布 16 资产 + feed，四平台构建/启动全绿；N-1 升级与 Win/Linux 安装/更新 QA 未完成） |
| DEV-125 | Electron 退役与默认通道切换 | 全部子票 | blocked |

## Epic 完成定义

- [ ] Rust core 覆盖当前桌面产品必需能力，且每个 shared channel 有明确迁移状态与真实实现或明确未迁移错误。
- [ ] Renderer 在 macOS WKWebView、Windows WebView2、Linux WebKitGTK 中通过编辑器矩阵；未实测平台不得标通过。
- [ ] Vault/FS/SQLite、Git、AI/召回、插件、打印、二进制编辑器、更新链路均有针对 Tauri 的回归证据。
- [ ] Tauri 产物完成签名/公证/更新策略与匿名下载验证；Windows/Linux 环境项补证或明确保持 blocked。
- [ ] Electron 默认通道切换与退役仅在上述门槛完成后执行。

## Out of scope

- 本票不直接承载代码实现；实现按子票执行。
- 不把 Cargo build 成功、单元测试通过或 macOS-only 冒烟写成跨平台完成。
- 不在票据阶段引入 Node sidecar 或删除 Electron。

## 2026-10-15 全面审查结论

DEV-115 的契约矩阵已加入 `pnpm test` 机械校验，当前 176 条记录为 174 `ported` / 1 `pending` / 1 `explicitly-unsupported`。DEV-115/116/118 已完成；DEV-117/119～124 均存在上述未验收项，DEV-125 继续 blocked。因此本 Epic 不能标 done，也不能切换默认下载通道或移除 Electron。
