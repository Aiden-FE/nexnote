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
| DEV-117 | 三 WebView 编辑器兼容矩阵 | DEV-116 | done（CI 真机启动矩阵三平台全绿：Windows WebView2 主窗口、Linux WebKitGTK/xvfb 窗口、macOS 双架构 GUI 冒烟；深层文档交互矩阵以 macOS 实测为准，Win/Linux 交互项按指示不作为阻塞） |
| DEV-118 | Rust product core 基础与状态生命周期 | DEV-115 | done |
| DEV-119 | Vault / FS / SQLite / 索引迁移 | DEV-118 | done（全部通道 ported；设置持久化重启回归已修复） |
| DEV-120 | Git 运行时与同步体系迁移 | DEV-119 | done（全部通道 ported，含 doctor 修复票据） |
| DEV-121 | AI、召回与内置语义向量迁移 | DEV-118 | done（agent 工具环/审批/权限/prompt/skills/降级/TTL/reasoning 过滤已迁移） |
| DEV-122 | 插件沙箱与 capability 迁移 | DEV-116、DEV-118 | done（插件通道 ported；宿主 capability 修复见 DEV-123） |
| DEV-123 | 二进制编辑器宿主与打印迁移 | DEV-116、DEV-117 | done（label 字符集修复后 e2e 协议测试覆盖；macOS 打开真实文档的 GUI 收尾项见矩阵） |
| DEV-124 | Tauri 更新、签名、发布与 QA | DEV-116 | done（公证决策 ad hoc；feed 已配置并发布候选 tauri-v0.0.37.1：16 资产含四平台签名 .sig + latest.json；匿名下载验证通过 latest.json 可取、DMG sha256 字节级一致） |
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
