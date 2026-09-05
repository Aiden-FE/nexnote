# NexNote 插件系统：运行时、安装与稳定 API 调研

> 调研范围：第三方块类型、视图、菜单、命令；用户本地安装；产品级 API 稳定性。本文区分**可由一手资料证实的机制事实**和面向 NexNote 的**架构建议**。

## 执行摘要

1. 不应把「第三方块」理解为让任意插件在宿主 React/编辑器进程中注册任意 Node/View：这会绕过运行时安全边界。应由内核预注册一个稳定的 `plugin_block` 容器节点；插件通过受校验的 schema、受限 RPC 与隔离视图扩展它。
2. **推荐的默认执行模型**是：`sandbox` iframe 承载交互 UI + `MessageChannel` RPC；可选 `QuickJS-in-WASM` worker 承载无 DOM 的业务逻辑。二者均只能取得经 capability 授权的 NexNote API。iframe 不是把编辑器 DOM 交给插件，而是插件 UI 的安全边界。
3. Web Worker 适合 CPU 工作、索引和转换，但单独不是第三方信任边界：它仍可 `fetch`，且同源上下文通常带来同源能力。Node 子进程仅作为用户明确同意的「桌面特权扩展」逃生阀，不能作为默认沙箱。
4. BlockSuite 的 `schema + service + view/widgets` 明确分层最贴近 NexNote 的块需求，但其官方 README 当前警告仓库将有重大变更且暂停接收 PR；不能把其内部扩展 API 直接承诺给第三方。02 号候选中，**BlockNote/ProseMirror** 的自定义块 schema 是最顺手的宿主实现起点，但其 React render callback 同样是同进程代码，不能直接暴露给不可信第三方。
5. API 采用「声明层、能力层、UI 层、数据/编辑层、特权层」五层；只将 JSON/RPC DTO、manifest 和贡献点作为稳定 public API。编辑器内核对象、DOM、React/Lit/ProseMirror/Lexical 实例全部保持私有。

---

## 1. 运行时选项：机制事实与取舍

### 对照表

| 选项 | 安全边界与能力暴露 | 性能/故障隔离 | 对扩展块类型的匹配 | NexNote 判断 |
| --- | --- | --- | --- | --- |
| `iframe sandbox` + `postMessage` | `sandbox` 令浏览上下文按 token 收窄能力；不授予 `allow-same-origin` 时可使其成为 opaque/null origin。跨窗口通信必须显式消息传递。`postMessage` 应指定精确 `targetOrigin`；只有 opaque origin 才因平台限制需 `*`，并额外验证 `event.source`/握手 nonce。[MDN sandbox](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/sandbox)、[MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) | 独立文档/渲染上下文，宿主可卸载 iframe；大对象要 structured-clone/传输，频繁同步编辑状态有延迟和复制成本。Figma 实测其文档模型下整份 scene 序列化曾达 14 秒，说明不要把内核树镜像给插件。[Figma 工程复盘](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/) | **UI 很匹配，原生 editor node 不匹配**：在 iframe 内渲染插件块 UI，由宿主的通用 `plugin_block` 保持选择、光标、undo、序列化；插件只能请求受限的 block 读/写操作。 | **默认 UI 边界**。采用本地 `nexnote-plugin://` 静态资源、`sandbox="allow-scripts"`（按需最小增权）、严格 CSP、一次性 `MessagePort` 与 schema 校验 RPC。 |
| Web Worker | Worker 不能直接操作 DOM，和主线程通过复制而非共享的数据消息通信；但可使用 `fetch`/`XMLHttpRequest`，所以“无 DOM”不等于“无网络/安全沙箱”。[MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) | 真正脱离 UI 线程，适合解析、转换、搜索等 CPU 任务；可 `terminate()` 回收失控任务。消息大、频繁时仍有 clone 成本。 | 不可直接画块或注册内核 node；只能计算 schema 校验、导入/导出、派生数据，再由宿主渲染或向 iframe 发消息。 | 作为**性能 worker**，不是单独的信任边界。若运行不可信代码，放在受控 iframe/专用 origin 内，并通过能力 RPC 限制网络与数据。 |
| QuickJS / WASM | WebAssembly 模块本身在宿主 embedding 的沙箱内执行，并只能通过导入的 API 接触外界；模块的函数/类型须在加载时声明。[WebAssembly 安全模型](https://webassembly.org/docs/security/)；QuickJS 是将 JS VM 再嵌入 WASM 的实现策略。Figma 在 Realms shim 漏洞后改为 QuickJS 编译到 WASM，理由是 VM 内外对象表示不同，插件只能经显式 API 出界。[Figma 安全复盘](https://www.figma.com/blog/an-update-on-plugin-security/) | 解释器/WASM 运行时通常比宿主 JIT JS 慢，且有 WASM 初始化、调试和内存限制工程成本；Figma 也明确称其为“某些插件较慢、但内在更安全”的取舍。[同上](https://www.figma.com/blog/an-update-on-plugin-security/) | 可安全运行块的 reducer、migration、命令逻辑，但不应直接取得 DOM 或编辑器实例。可与 iframe UI 配套：VM 逻辑 → RPC → 宿主通用节点/iframe UI。 | **推荐的第二阶段 logic runtime**，优先在可终止 Worker 中运行；限定 CPU/内存/消息大小，导入仅为冻结的 capability proxy。不要用同一个 JS realm “删掉 window 属性”假装沙箱。 |
| Node 子进程（桌面壳） | 进程边界和 IPC 便于最小协议授权，但 Node 自己不适合执行恶意插件。Node 官方明确 Permission Model 是防止可信代码误用资源的“seat belt”，**不对恶意代码提供安全保证**；其可限制 fs/net/child process/worker/addon/WASI/FFI 等。[Node Permission Model](https://nodejs.org/api/permissions.html) | 不阻塞 UI、可重启/杀死；启动与 IPC 开销较高，文件访问和系统调用很强。必须再用 OS 账户/容器/沙箱隔离；Node 文档也说明跨进程隔离属于 OS 责任。[同上](https://nodejs.org/api/permissions.html) | 可提供 Git、外部 CLI、重型索引等桌面能力；不应获得 editor object。块 UI 仍走 iframe/宿主。 | **不是默认运行时**；仅 `desktop-privileged` 模式，安装/首次启用逐项确认、独立进程、无 native addon/FFI、RPC allowlist，且未来以 OS sandbox 强化。 |

### 两个不可省略的边界

- **浏览器/Electron renderer 边界。** Electron 安全指南要求隔离不可信 renderer：启用 `contextIsolation` 与 process sandbox、不要把 Node integration 给远程内容、验证全部 IPC sender，且不要暴露原始 `ipcRenderer`/Electron API。[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) 因而 preload 只能公开小而具体的 NexNote bridge，不能把 `fs`、`ipcRenderer` 或宿主对象透传给插件。
- **API/数据边界。** 所有跨界消息均应是可版本化 JSON DTO，而不是对象引用、函数回调或 editor instance。Figma 的当前模型正是“主线程 sandbox 可访问 scene、无 browser API；iframe 可访问 browser API、不可访问 scene；二者 message passing”。[Figma How Plugins Run](https://www.figma.com/plugin-docs/how-plugins-run/)

---

## 2. 参考对象：可复用事实与不应照搬之处

### Obsidian：本地桌面高能力的产品取舍

- 官方 `manifest.json` 要求 `id`、`name`、SemVer `version`、`minAppVersion`、`description`、`isDesktopOnly`；`id` 是受限字符的稳定标识，且开发时应与插件目录同名。[Manifest 参考](https://docs.obsidian.md/Reference/Manifest)
- 它让插件声明 `isDesktopOnly`；官方提交要求明确：使用 Node.js/Electron API 时必须设为 `true`，这些 API 仅桌面可用。[提交要求](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) 本地开发流程则将编译所得 `main.js` 放进 Vault 的 `.obsidian/plugins/<id>`，由用户启用。[官方教程](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin/)
- 该模型是“用户安装的桌面 JS 获得较高能力”的生态取舍，而非安全 sandbox。Obsidian 自己仍要求避免 `innerHTML` 等来自用户输入的注入路径，并建议用受管理的注册 API 以便卸载时清理资源。[Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) **借鉴 manifest、兼容回退与生命周期；不借鉴默认全能力执行。**
- 兼容版本的做法值得复用：`versions.json` 映射“插件版本 → 最低 app 版本”，仅在提高最低 app 版本时需要追加，从而给旧宿主提供可选回退版本。[Obsidian versions](https://docs.obsidian.md/Reference/Versions)

### AFFiNE / BlockSuite：块的 schema—行为—视图三分法

- BlockSuite 源自 AFFiNE，并提供 `PageEditor`/`EdgelessEditor`；其 README 将 `@blocksuite/store` 描述为以 Yjs 为基础的协作数据层，`@blocksuite/block-std` 为覆盖块字段、事件、selection、clipboard 的框架无关层。[官方 README](https://github.com/toeverything/blocksuite#readme)
- `BlockSpec` 将 **schema、service、view（component/widgets）**组合；schema 可定义唯一 `flavour`、props、版本、块角色以及允许的 parent/children；view 可由不同 UI 框架实现。[BlockSpec](https://blocksuite.io/guide/block-spec)、[BlockSchema](https://blocksuite.io/guide/block-schema)、[Block tree](https://blocksuite.io/guide/working-with-block-tree) 这正是 NexNote 可借鉴的公共“块声明”形状。
- 风险：其 README 同时警告仓库将有重大变化、暂停接受 PR，且将 extension capabilities 描述为“under refinement”。[README 的 warning/overview](https://github.com/toeverything/blocksuite#readme) 因此不要把 BlockSuite 私有类型或 `host.specs` 直接当 NexNote 永久第三方 ABI。

### tldraw：显式 schema、验证与迁移优先

- tldraw 的 custom shape 是 JSON record；每种 shape 有 `ShapeUtil` 定义渲染、几何、交互。注册时将 util 传给 `Tldraw`，并建议以 `static props` 校验 props；自定义 store schema 还需纳入 props 与 migrations。[官方 Shapes 文档](https://tldraw.dev/docs/shapes) 
- 可复用的启示是：插件数据必须是 JSON-serializable、schema 可验证、每个数据演进有 migration；**不可直接照搬**“把第三方 `ShapeUtil` class 传进宿主 React”的同进程执行方式作为不可信插件方案。

### VS Code：runtime 分层、按需激活、信任状态

- VS Code 同时有本地/远端 Node.js extension host 及 browser WebWorker extension host；manifest 以 `main`/`browser` 表示入口，以 `extensionKind` 表示优选位置。[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host) Manifest 则使用 SemVer `version`、宿主 `engines.vscode`、`main`/`browser`、`activationEvents` 和 declarative `contributes`。[Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- 其 extension host 目标包含避免插件影响启动、UI 操作与 UI 本身，并以 activation event 延迟加载。[Extension Host：Stability and Performance](https://code.visualstudio.com/api/advanced-topics/extension-host) 这是 NexNote 命令/视图贡献应采用懒激活的直接先例。
- Workspace Trust 明确承认 extension 能执行有害代码：Restricted Mode 会禁用/限制 extension，但官方仍警告无法阻止恶意 extension 忽略 Restricted Mode，只应运行信任发布者的扩展。[Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust) 这支持 NexNote 同时提供“未信任知识库/未信任插件”状态，而非把目录审核当沙箱。

### Figma：最接近本题的能力模型

- Figma manifest 分离 `main` sandbox 入口与 `ui` iframe，声明 `api` 版本、`editorType`、菜单、`documentAccess`，并可通过 `networkAccess.allowedDomains` 限制网络域名；使用 `*` 必须说明原因。[Figma Manifest](https://www.figma.com/plugin-docs/manifest/)
- 它还记录了真实安全事故：依赖同 VM 的 Realms shim 曾发现 sandbox escape 漏洞，后改为 QuickJS→WASM；这不是否定 iframe/Realm，而是提醒 NexNote 以浏览器/VM 的真实隔离与最小 capability 为边界，持续升级和可替换 runtime。[Figma 安全更新](https://www.figma.com/blog/an-update-on-plugin-security/)

---

## 3. 本地安装格式与安全基线

### 建议的包布局（NexNote 规范草案）

采用不可变 zip/tar 包（例如 `.nexplugin`）或等价的已解压目录；安装器先解压到 app 私有目录，再从**已验证的 manifest**加载，不从知识库目录自动执行。建议：

```text
acme.task-board-1.4.0.nexplugin
├── manifest.json                # 必需、签名覆盖的规范入口
├── dist/logic.js                # 可选：QuickJS/WASM logic entry
├── dist/ui.html                 # 可选：sandbox iframe UI entry
├── dist/ui.js
├── assets/
├── schemas/task-board.schema.json
├── migrations/1-to-2.js         # 仅受控 logic runtime 中执行
├── LICENSE
└── SIGNATURE.json               # package digest、key id、签名/证明
```

`manifest.json` 的建议字段（字段设计建议，不是假称为既有标准）：

```json
{
  "schemaVersion": 1,
  "id": "com.acme.task-board",
  "name": "Task Board",
  "version": "1.4.0",
  "nexnoteApi": "^1.2.0",
  "minAppVersion": "1.0.0",
  "publisher": { "id": "acme", "name": "Acme" },
  "license": "MIT",
  "entries": { "ui": "dist/ui.html", "logic": "dist/logic.js" },
  "activationEvents": ["onCommand:acme.task-board.open", "onBlock:com.acme.task-board"],
  "contributes": { "commands": [], "menus": [], "views": [], "blockTypes": [] },
  "capabilities": { "vault": ["read"], "blocks": ["read", "write-own"], "network": ["https://api.acme.example"] },
  "integrity": "sha512-..."
}
```

**字段先例。** Obsidian 提供稳定 `id/version/minAppVersion/isDesktopOnly`，VS Code 提供 `engines/main/browser/activationEvents/contributes`，Figma 将 `main/ui` 与 domain allowlist 放在 manifest；上述字段是把三者适配为本地优先产品，而非复制任何单一格式。[Obsidian Manifest](https://docs.obsidian.md/Reference/Manifest)、[VS Code Manifest](https://code.visualstudio.com/api/references/extension-manifest)、[Figma Manifest](https://www.figma.com/plugin-docs/manifest/)

### 版本与升级策略

1. `id` 永不复用、全局命名空间（建议 reverse-DNS）；`version`、`nexnoteApi`、`minAppVersion` 全部 SemVer。宿主仅在 `nexnoteApi` 的 major 兼容时加载；未知 manifest major 拒绝安装。
2. Public API **只增不改**在同一 major 中；删除/语义改变仅在下一个 major；每个 experimental API 显式带 `experimental` namespace，绝不承诺稳定。
3. 包含 API 兼容矩阵或 release channel（stable/beta）。可参照 Obsidian `versions.json` 在宿主过旧时选择兼容旧插件版本，而不要“最新包安装后静默坏掉”。[Obsidian versions](https://docs.obsidian.md/Reference/Versions)
4. 块数据声明 `type`、`dataVersion`、JSON Schema 与显式 migration；升级先复制/备份、运行 migration、原子提交；失败保留原数据并禁用插件。禁止插件任意扫描/批量改写知识库。

### 安全基线（本地 sideload 也适用）

| 基线 | 最低要求 |
| --- | --- |
| 完整性与来源 | 安装器计算归档内容 canonical digest，与 `SIGNATURE.json` 及可信 publisher key 验证；锁定 `id + version + digest + publisher key id`。npm 的 registry ECDSA 签名正是签名 `name@version:tarball integrity` 的可参考供应链模式。[npm registry signatures](https://docs.npmjs.com/about-registry-signatures/) |
| 证明与审计 | 发布渠道保存 source commit、构建 workflow、透明日志/provenance；npm provenance 显示 build environment、workflow、source commit 与透明日志，`npm audit signatures` 可校验签名和 attestation。[npm provenance](https://docs.npmjs.com/viewing-package-provenance/) |
| 安装同意 | 显示 publisher、精确版本/digest、能力 diff、网络域名和 `desktop-privileged` 警告；升级遇新增 capability 必须重新确认。未签名 sideload 默认“开发者模式/高风险”，不自动启用。 |
| 最小权限 | 默认无 vault 写、无网络、无剪贴板、无 shell；能力按 `plugin + vault + scope` 授予，可撤销。网络使用 domain/path allowlist（Figma 的 `networkAccess` 是直接先例）。[Figma Manifest](https://www.figma.com/plugin-docs/manifest/) |
| Electron 防护 | `contextIsolation: true`、renderer sandbox、严格 CSP、只允许受控 `nexnote-plugin://`，验证 IPC sender，绝不将 Electron/Node 原始 API 注入插件页面。[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) |
| 审核与处置 | 目录审核、revocation list、kill switch、崩溃隔离和审计日志是纵深防御；不能替代 sandbox。Figma 明确称人工审核会漏报，依赖 sandbox 强制安全边界。[Figma 安全更新](https://www.figma.com/blog/an-update-on-plugin-security/) |

---

## 4. 编辑器内核的耦合面（对 02 号候选的含义）

### 先给结论

- **不可信第三方的稳定耦合面应是 NexNote 自己的 `PluginBlock` 协议，不是任何编辑器的 Node class。** 编辑器在运行中通常将 node schema、selection、transaction、DOM 生命周期紧密耦合；让隔离插件注册原生 node 必然要求在同一 JS/DOM realm 执行。
- 若 02 号票选择 **BlockNote/ProseMirror**，它最便于宿主实现块产品：BlockNote 的 `createReactBlockSpec` 明确声明 `type`、`propSchema`、`content`，并将 BlockSpec 放入 editor schema；但 `render` 直接接收 `editor`，因此此接口只能给**NexNote 内置或已审计的 trusted adapter**使用，绝不能是 public untrusted API。[BlockNote Custom Blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)
- 若选择 **TipTap/ProseMirror**，以宿主编译时锁定 schema、预留一个 atom/block `plugin_block` 最稳。ProseMirror 要求 document 符合指定 schema，plugin 在 `EditorState` 创建时注册并取得 transaction；它是强大的内核扩展点，却不是进程隔离点。[ProseMirror Guide](https://prosemirror.net/docs/guide/)
- **Lexical** 的新 Extensions 把构造前（nodes、node replacement、theme）和构造后（listeners、transforms、commands）配置收口，并支持 dependency；对内核产品化很好，但同样是宿主 JS API，公开给不可信方仍会造成同 realm 执行。[Lexical Extensions](https://lexical.dev/docs/extensions/intro)
- **BlockSuite** 在概念上最接近“公开块 contract”：schema/service/view 可分离，且不同 view 可围绕同一 schema；但当前变更风险使它适合作为设计参考或内部实现，非首发 public ABI。[BlockSuite BlockSpec](https://blocksuite.io/guide/block-spec)、[README warning](https://github.com/toeverything/blocksuite#readme)

### 推荐的内核适配形状

```text
第三方 manifest / JSON Schema
        │（安装时验证）
NexNote Plugin Registry ──> 内核私有 Adapter（唯一能接触 BlockNote/PM/Lexical）
        │                         │
        │                      预注册 PluginBlock(type, data, dataVersion, presentation)
        │                         │
Sandbox UI/Logic ←── capability RPC ┴── transaction/undo/selection/Markdown serializer
```

`PluginBlock` 保留以下宿主职责：块 ID、父子约束、焦点/选择、拖拽、undo/redo、clipboard、Markdown sidecar 编解码、未知插件的 fallback 渲染。插件只能：

- 声明命名空间 `blockType`、版本化 JSON Schema、允许的 presentation（`inline`/`card`/`embed`）、受限菜单/命令贡献；
- 读取当前块的**投影快照**，提出 `setOwnBlockData`、`insertBlock` 等经 schema/权限校验的意图；
- 在 iframe 内绘制其 UI，或提供无 UI 的逻辑/migration；
- 绝不直接收到 `EditorView`、`EditorState`、React context、DOM element、NexNote 全量页面树或 raw filesystem handle。

这也避开 iframe/RPC 复制大编辑器树的问题：传递“当前块 + 必要上下文 + revision”，写入用 optimistic `expectedRevision`，冲突时重读，不传递整个 page/文档模型。

---

## 5. 运行时建议与 API 分层草案

### 推荐方案：分阶段、可替换的混合模型

**MVP（建议采用）**

1. 宿主内核预注册 `plugin_block`，只加载 manifest 中 declarative 的命令、菜单、视图和 schema；命令使用 activation event 懒加载。
2. 每个第三方交互视图运行于独立 sandbox iframe；主进程/renderer 使用 `MessageChannel` 建立一次性端口，全部 request/response 有 `{apiVersion, requestId, capability, payload}`，payload 用 JSON Schema 验证、限长、限频、可取消。
3. UI 只读默认；用户授权后授予 scoped `blocks.write-own`/`vault.read(path glob)` 等能力。命令、菜单注册是 declarative contribution，由宿主渲染，点击后才激活插件。
4. 没有安装或被禁用插件时，`plugin_block` 显示 type、publisher、原始 data 摘要和“安全模式”提示，但不丢失内容；导出保留 namespace/data 的 sidecar。

**V1（logic runtime）**

- 引入 `QuickJS/WASM` logic worker，承载 migration、纯计算、导入/导出和命令 reducer；设置 wall-clock deadline、消息/内存预算，超限终止 worker 并禁用本次运行。其 imports 是 capability RPC，而非 Node/DOM globals。
- plugin UI 与 logic 可相互发业务消息，但所有写操作仍经宿主 transaction gateway。

**后续（特权扩展）**

- 仅给经签名、用户明确批准、可能经目录审核的 `desktop-privileged` 包提供 Node 子进程。其默认 scopes 仍为空；禁止 native addon/FFI、要求可审计 IPC contract。Node Permission Model 可做“意外访问”防护，但不能被宣称为恶意插件 sandbox。[Node Permission Model](https://nodejs.org/api/permissions.html)

### Public API 五层

| 层 | 稳定 API 应提供 | 明确不提供 |
| --- | --- | --- |
| 0. Manifest / install | ID、SemVer/API range、入口、activation、contributes、capabilities、integrity、publisher | 任意脚本安装后自动执行；隐式权限 |
| 1. 声明层 | `blockTypes` JSON Schema、data migration metadata、commands、menus、views、settings schema | JS class 直接注册到 editor schema/React tree |
| 2. Capability 层 | `requestCapability`、per-vault grant、permission status、revocation、审计事件 | `fs`、Node、Electron、原始 IPC、全局网络 |
| 3. UI / lifecycle 层 | iframe bootstrap、主题/token、locale、selection/block snapshot、`onActivate/onSuspend/onDispose` | 宿主 DOM/React context/editor object；未验证 HTML 注入 |
| 4. 数据与编辑层 | versioned query DTO、`transact(intent, expectedRevision)`、block-local CRUD、批量操作需显式 scope | 文件路径逃逸、全量知识库扫描、绕过 undo/transaction 的直接 mutation |
| 5. 特权层 | 单独 package kind、子进程 RPC、显式 capability、健康检查与 kill | 默认开启；把 Node permission flags 当成完整 sandbox |

### 可直接进入架构决策票的决策语句

> NexNote 的首发 third-party plugin runtime 采用 **sandbox iframe UI + capability RPC + 宿主预注册 `plugin_block`**；可选 QuickJS/WASM worker 用于无 DOM 的逻辑。第三方不得直接注册编辑器 Node/View 或获取 DOM/Node/Electron。Node 子进程仅为显式批准的 `desktop-privileged` 扩展保留，且不以 Node Permission Model 作为恶意代码隔离承诺。Public API 只承诺 manifest、JSON DTO、贡献点和事务意图；编辑器内核 API 保持私有并由 adapter 吸收替换成本。

### 备选与触发条件

- **备选 A：受审计同进程 native block adapter。** 仅面向 NexNote 官方/强审核合作伙伴，利用 BlockNote/ProseMirror、Lexical 或 BlockSuite 的原生自定义 Node API，换取最低延迟与完整编辑体验；必须标为非默认高信任模式，不能改变普通插件 threat model。
- **备选 B：QuickJS/WASM-first。** 若块交互大多为自动化而非丰富自定义 UI，优先 VM logic、仅少量 iframe；安全面更小但开发者工具、性能、调试投入更大。Figma 的变更是此路线已在生产中验证的事实参考，而不是零成本实现。[Figma 安全更新](https://www.figma.com/blog/an-update-on-plugin-security/)
- **不推荐：直接 Web Worker 或 Node host 作为普通插件默认。** 前者没有足够能力隔离，后者权限面过大；两者都不能解决“安全注册编辑器 node”的根问题。

---

## 一手来源索引

- [MDN：iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/sandbox)、[postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)、[Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [WebAssembly Security](https://webassembly.org/docs/security/)、[Node Permission Model](https://nodejs.org/api/permissions.html)、[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Figma：How Plugins Run](https://www.figma.com/plugin-docs/how-plugins-run/)、[Manifest](https://www.figma.com/plugin-docs/manifest/)、[runtime 安全复盘](https://www.figma.com/blog/an-update-on-plugin-security/)、[iframe/VM 设计复盘](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
- [Obsidian Manifest](https://docs.obsidian.md/Reference/Manifest)、[Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin/)、[plugin 提交要求](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)、[版本回退](https://docs.obsidian.md/Reference/Versions)
- [BlockSuite README](https://github.com/toeverything/blocksuite#readme)、[BlockSpec](https://blocksuite.io/guide/block-spec)、[BlockSchema](https://blocksuite.io/guide/block-schema)、[tldraw Shapes](https://tldraw.dev/docs/shapes)
- [VS Code Manifest](https://code.visualstudio.com/api/references/extension-manifest)、[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)、[Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust)
- [BlockNote Custom Blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)、[ProseMirror Guide](https://prosemirror.net/docs/guide/)、[Lexical Extensions](https://lexical.dev/docs/extensions/intro)
- [npm registry signatures](https://docs.npmjs.com/about-registry-signatures/)、[npm provenance](https://docs.npmjs.com/viewing-package-provenance/)
