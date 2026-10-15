# DEV-122 Tauri 插件沙箱与 capability 迁移

- 状态：partial
- 分类：architecture / security
- 优先级：P1
- 工作量：XL
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-116、DEV-118、`docs/research/plugin-system.md`

## 背景

现有插件系统依赖 sandbox iframe、`MessageChannel`、manifest/包完整性校验、能力授权、审计与插件快照目录。Electron preload 边界不复存在后，必须重新证明 Tauri asset protocol、WebView origin、CSP 与 capability 不能让插件获得宿主文件、网络或原生命令能力。

## 方案

1. 设计 Tauri 插件资源加载边界：
   - 插件只从只读快照目录加载；
   - 独立 origin / custom protocol；
   - sandbox iframe 与最小 CSP；
   - 不授予 broad fs / shell / opener capability。
2. 迁移安装与生命周期：
   - zip 目录遍历防御、大小限制、manifest/schema 校验；
   - hash 固化快照、启停、卸载、升级；
   - crash/heartbeat/audit 状态持久化。
3. 迁移 capability RPC：
   - `read` / `edit` / `filesystem` / `network` / `external-command` / `desktop-privileged` 语义保持或明确降级；
   - 请求走 Rust product core 审批，不允许 WebView 直接访问 Tauri plugin API；
   - 每个权限有 per-vault / per-plugin 授权与撤销。
4. 保留插件贡献的检索 Skill 约束：插件只传策略参数，不接触文件内容。
5. 建立恶意插件 fixture：路径逃逸 zip、超限文件、非法 manifest、越权 RPC、网络请求、崩溃/心跳超时。

## 验收标准

- [ ] 未授权插件无法访问 vault 文件、任意文件系统、网络、外部命令和宿主窗口 API。
- [ ] manifest、权限、贡献点、版本兼容与审计语义有测试。
- [ ] 插件 crash / heartbeat timeout 不影响主窗口；状态可恢复。
- [ ] 恶意 fixture 全部 fail closed，并记录审计事件。
- [ ] 内置 Mermaid/KaTeX 与示例插件可安装、启停、卸载。
- [ ] macOS 实测；Windows/Linux WebView sandbox 行为保持 **NOT_RUN（当前无实测条件）**。

## 2026-10-15 审查结论

插件 manifest/ZIP/安装/权限/审计 store 已有 Rust 测试。session 绑定（nonce/origin/sessionId/token/pluginId）、一次性 challenge 授权、`plugins:rpc` 四类方法分派、动态 command 注册、crash 吊销与 directory/zip 系统选择器已实现并有针对性测试。真实 WebView sandbox GUI、crash/heartbeat 全链路与恶意 fixture 全矩阵仍未补证，本票保持 `partial`。

## Out of scope

- 插件商店与签名分发体系。
- QuickJS/WASM logic runtime 的新增执行模型；除非另行决策。
