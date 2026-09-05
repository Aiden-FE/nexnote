# 桌面壳与前端框架选型调研（Tauri vs Electron · 前端框架）

> 票据：`.scratch/nexnote-mvp/issues/01-desktop-shell-research.md`
> 调研日期：2026-09-05 · 方法：一手来源优先（官方文档 / GitHub 仓库 / 官方 issue tracker），第三方基准仅作量级参考并明确标注。
> 约束回顾：单人 + AI 结对 · 对外产品标准 · Win/macOS/Linux 三端 · 编辑器重度应用（块编辑、拖拽、IME、大 DOM）。

---

## TL;DR

- **桌面壳：Electron（主选）**。编辑器重度应用的第一优先级是三端渲染引擎一致性，Electron 捆绑同一份 Chromium 做到了这一点；Tauri 在三端跑三种引擎（WebView2 / WKWebView / WebKitGTK），每种引擎对 contenteditable、IME、拖拽都有独立的长尾坑，单人测试面不可承受。同赛道产品（Obsidian、Logseq、SiYuan、AFFiNE、GitHub Desktop、VS Code）全部是 Electron；AFFiNE 2022 年曾切到 Tauri、2023 年又切回 Electron。
- **前端框架：React + TypeScript（主选）**。块编辑器（BlockNote / Lexical / Plate / Slate）、节点图谱（React Flow）、dock 布局（dockview-react）在 React 生态均有官方维护的成套方案，单人维护面最小；底层图谱库（sigma.js / cytoscape.js）框架无关可兜底。
- **建议组合：Electron + React + TS，编辑器内核独立成框架无关包（ProseMirror/TipTap core 层）**，为后续换壳留缝。
- **备选**：壳 = Tauri 2（体积/内存优势显著，但接受 Linux IME 与三引擎风险）；框架 = Vue 3 + TipTap（块编辑器选择面骤减）。

---

## 1. 对比矩阵 A：桌面壳（Tauri 2 vs Electron）

| 维度 | Electron | Tauri 2 | 对 NexNote 的权重 |
|---|---|---|---|
| 安装包体积（空应用） | ~120–200 MB（自带 Chromium+Node） | ~3–15 MB（系统 webview）〔第三方基准，量级参考〕 | 中 |
| 空闲内存 | 高（~180 MB 起）〔第三方基准〕 | 低（~40 MB 起）〔第三方基准〕 | 中 |
| 渲染引擎一致性 | **三端同一 Chromium**，可锁定版本 | 三端三种引擎：WebView2(Chromium) / WKWebView(WebKit) / WebKitGTK(WebKit) | **极高** |
| contenteditable / IME | Chromium 行为，与 Chrome 一致，可测可控 | Linux IME 长期不稳（fcitx/ibus 定位、preedit）；macOS WKWebView 有 WebKit composition 事件顺序 bug | **极高**（中文输入硬需求） |
| 拖拽（块拖拽） | 标准 Chromium HTML5 DnD | macOS 默认 `fileDropEnabled` 拦截全部 DOM 拖拽，需手工关闭 | **极高** |
| 大 DOM / 滚动性能 | Chromium，行业基准 | Win≈Chromium；macOS 尚可；Linux WebKitGTK 有官方性能 meta bug（滚动/动画/拖放/输入） | 高 |
| 自动更新 | 内置 autoUpdater（macOS Squirrel 免配置；Windows NSIS/Squirrel）；**Linux 无内置，靠包管理器** | tauri-plugin-updater，**签名强制不可关**，丢私钥=存量用户断更；支持 AppImage/deb | 高 |
| 外部二进制（git） | electron-builder `extraResources` → `process.resourcesPath` + Node child_process；**dugite/dugite-native 成熟先例** | `externalBin` sidecar 一等公民（target-triple 命名），Shell plugin spawn | 高 |
| 主进程语言 | Node.js（JS/TS 全栈） | Rust（壳层开发需要 Rust 能力） | 中高（单人+AI） |
| 桌面生态先例 | Obsidian、Logseq、SiYuan、AFFiNE、GitHub Desktop、VS Code | 知识库/编辑器赛道头部产品暂无长期跑通的先例 | 高 |
| License | MIT | MIT OR Apache-2.0 | 低（两者皆可闭源商用） |
| Windows 运行时依赖 | 无（Chromium 自带） | 依赖 WebView2 Evergreen（Win11 自带；老系统需 bootstrapper 联网装） | 低中 |

### 1.1 打包与体积

- Electron 每个安装包内含完整 Chromium 与 Node.js 运行时；Tauri 复用操作系统 webview，仅打包 Rust core + 前端产物（[Tauri sidecar 文档](https://v2.tauri.app/develop/sidecar/)）。
- 量级参考（第三方基准，非官方数据）：Electron 30 空应用 ~187 MB vs Tauri 2.0 ~14 MB；空闲内存 187 MB vs 42 MB（[johal.in 基准 1](https://johal.in/tauri-20-vs-electron-30-desktop-app-bundle)、[基准 2（Markdown 编辑器场景）](https://johal.in/benchmarks-performance-tauri-20-vs-electron-30-markdown)）。
- Windows 侧 Tauri 依赖 WebView2 Evergreen 运行时：Win11 系统自带，Win7/10 未必预装，安装器可嵌 bootstrapper 或离线安装器（[Tauri Windows Installer 文档](https://v2.tauri.app/distribute/windows-installer/)、[Microsoft WebView2 分发文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)）。国内网络环境下载 bootstrapper 是一个真实摩擦点。
- **对本产品的判断**：对"对外产品标准"的编辑器应用，~150–200 MB 安装包是行业常态（Obsidian/SiYuan 同量级），体积劣势不构成否决项。

### 1.2 自动更新

- **Electron**：内置 `autoUpdater`，macOS 基于 Squirrel.Mac"无需任何配置"；Windows 用 Squirrel.Windows 或（主流路径）electron-builder 生成 NSIS + 自建/GitHub Releases 更新源。官方明确 **Linux 无内置自动更新，推荐用发行版包管理器**（[autoUpdater 官方文档](https://electronjs.org/docs/latest/api/auto-updater)、[Updates 教程](https://github.com/electron/electron/blob/v41.2.0/docs/tutorial/updates.md)、[update.electronjs.org 免费服务](https://github.com/electron/update.electronjs.org)）。macOS 顺利更新前提是开发者证书签名 + notarization。
- **Tauri 2**：官方 plugin-updater，**强制签名校验且不可禁用**；公钥进 `tauri.conf.json`，私钥丢失则已发布用户永远无法再收到更新；更新源是一个静态 JSON endpoint，Win/macOS/Linux(AppImage) 都支持（[Updater 官方文档](https://v2.tauri.app/plugin/updater/)、[plugins-workspace 源码](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater)）。
- **对比判断**：两边 macOS/Windows 更新路径成熟度接近（Electron 生态默认值更多，Tauri 签名管理更严格）；Linux 上 Electron 反而无官方统一方案（AppImage + AppImageUpdate 或发行版仓库），Tauri 的 AppImage updater 略顺。**对单人开发者，Electron 的"丢密钥风险"更低**（签名是 OS 层证书，丢了可重签；Tauri updater 私钥丢失直接断更）。

### 1.3 进程模型与 sidecar

- **Electron**：main 进程（Node.js，完整 fs/net 能力）+ 多 renderer 进程（Chromium，默认沙箱）；派生外部进程用 `child_process` / `utilityProcess`；捆绑外部二进制的官方路径是 electron-builder 的 `extraResources`（复制到 macOS `Contents/Resources/`、Win/Linux `resources/`，运行时经 `process.resourcesPath` 定位，天然在 asar 之外）（[electron-builder Application Contents](https://www.electron.build/docs/contents)）。
- **Tauri**：Rust core 进程持有系统能力，前端跑在系统 webview；sidecar 是一等公民：`bundle.externalBin` 声明（需按 target triple 命名，如 `git-x86_64-pc-windows-msvc.exe`），经 Shell plugin 的 `Command` API spawn（[Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)、[Node.js sidecar 官方教程](https://v2.tauri.app/learn/sidecar-nodejs/)）。
- **判断**：机制上两者都能干净地捆绑并 spawn git；Tauri 的声明式 sidecar 更正规，Electron 的 `extraResources + child_process` 模式有 GitHub Desktop（dugite）多年生产验证。**差异不在能力，在"壳层语言"**：Electron 全 TS，Tauri 壳层要写 Rust（单人 + AI 结对下 TS 侧迭代更快，Rust 侧排错面更陡）。

### 1.4 系统 webview 差异：复杂编辑器的实际坑（一手 issue 证据）

这是本票最关键的维度。NexNote 的核心交互 = contenteditable 块编辑 + 块拖拽 + 中文 IME 长文档（大 DOM）。

**Linux（WebKitGTK）——风险最高：**

- IME 候选窗定位错乱（fcitx5/sway，"every tauri program will happen"）：[tauri#5986](https://github.com/tauri-apps/tauri/issues/5986)
- Tauri v2 日文 IME 输入窗脱离输入框（v1 正常、v2 回归）：[tauri#11412](https://github.com/tauri-apps/tauri/issues/11412)
- 不响应 Linux Compose key（KDE）：[tauri#15859](https://github.com/tauri-apps/tauri/issues/15859)
- 韩文 preedit 组合被丢弃/闪烁，wry 需增加可配置项绕过：[wry PR#1724](https://github.com/tauri-apps/wry/pull/1724)
- WebKitGTK 官方性能 meta bug：滚动、动画、拖放、输入普遍慢于 Chromium/Firefox（[WebKit bug 245783](https://bugs.webkit.org/show_bug.cgi?id=245783)）；页面加载慢于 Firefox（[bug 291796](https://bugs.webkit.org/show_bug.cgi?id=291796)）；wry 维护者公开征集 Linux 性能差样本（[wry#890](https://github.com/tauri-apps/wry/issues/890)）

**macOS（WKWebView）：**

- Tauri 默认 `fileDropEnabled=true` 在 WKWebView 原生层拦截**所有** drag-and-drop，导致富文本编辑器内部"能拖不能放"，需显式关闭该配置（[tauri#3722](https://github.com/tauri-apps/tauri/issues/3722)）——对以块拖拽为核心交互的应用是必须提前踩掉的坑。
- WebKit composition 事件顺序违反规范（`compositionend` 先于提交 `keydown` 且 `isComposing=false`），长期影响 contenteditable 中文/日文输入，2025 年才在 WebKit 侧修复转正（[contenteditable 实验记录 CE-0567](https://contenteditable.realerror.com/cases/ce-0567-safari-composition-event-order/)、[WebKit PR#62264](https://github.com/WebKit/WebKit/pull/62264)）——WKWebView 与 Safari 同引擎，系统老版本拿不到修复。
- 有项目被迫把 HTML5 DnD 整体替换为 mousedown/mousemove 模拟以兼容 WKWebView（[worldmonitor PR#313](https://github.com/koala73/worldmonitor/pull/313)）。

**Windows（WebView2）：**

- WebView2 基于 Chromium，行为与 Chrome 一致，编辑器兼容性最好；曾出现的 Chromium IME regression 属上游个案且 Electron 锁定 Chromium 版本可测可控。

**竞品回退实证（最有说服力的信号）：**

- AFFiNE（块编辑 + 白板，与本产品最接近的赛道）：2022-11 用 Tauri 做桌面壳（[PR#935](https://github.com/toeverything/AFFiNE/pull/935)），2023 年切回 Electron，当前官方架构文档明确 Electron 桌面端（[AFFiNE Desktop 官方文档](https://toeverything-affine.mintlify.app/platforms/desktop)；官方社区帖 [Why Shift from Tauri to Electron](https://community.affine.pro/c/questions-answers/why-shift-from-tauri-to-electron) 存在但正文抓取受限）。
- 同赛道桌面壳全为 Electron：Logseq（[源码 src/electron](https://github.com/logseq/logseq)）、SiYuan（[Electron main + Go kernel 架构](https://deepwiki.com/siyuan-note/siyuan/4.1-application-bootstrap-and-window-management)）、GitHub Desktop、VS Code；Obsidian 亦基于 Chromium 内核发行。
- 结论：**编辑器重应用没有一个长期跑在系统 webview 上的头部先例，而"试过 Tauri 又回来"的先例至少一个。**

### 1.5 Git 二进制集成路径（外部 git / 捆绑 git）

- **成熟先例 = GitHub Desktop 的 dugite 体系**：[`dugite-native`](https://github.com/desktop/dugite-native) 构建面向"应用内脚本化调用"优化的跨平台 Git（裁掉 Git-LFS/GCM 等非核心件）；[`dugite`](https://github.com/desktop/dugite) npm 包负责下载与解析嵌入式 Git 路径（`resolveEmbeddedGit`），GitHub Desktop 闭源商用多年，证明**"捆绑 GPL git 二进制 + 闭源宿主"的子进程模式可行**。
- **License 合规**：Git / Git for Windows 为 **GPLv2**（含 MSYS2 等 GPL 组件）（[git-for-windows COPYING](https://github.com/git-for-windows/git/blob/HEAD/COPYING)、[FAQ](https://gitforwindows.org/faq)）。作为独立进程调用并随发行版附带原 license 与源码获取途径即可，dugite-native 即此模式；Electron（[MIT](https://github.com/electron/electron/blob/main/LICENSE)）与 Tauri（[MIT OR Apache-2.0](https://github.com/tauri-apps/tauri/blob/dev/LICENSE_APACHE-2.0)）宿主自身 license 均无障碍。
- **平台现实**：macOS 系统自带 Apple Git（Xcode CLT），Linux 发行版自带 git——**真正需要捆绑的只有 Windows**，dugite-native 三平台产物齐备。
- **纯 JS 替代（isomorphic-git，MIT）不建议作主通道**：纯 JS 重实现，大仓库（数 GB、多分支）有 pack 文件与超时问题（[isomorphic-git#2017](https://github.com/isomorphic-git/isomorphic-git/issues/2017)），且 NexNote 的"置信度=Git 提交历史"需要全量、可靠的历史读取，原生 git 更稳。
- **两条壳的落地路径**：Electron → `extraResources` 放 dugite-native 产物 + Node `child_process`；Tauri → `externalBin` sidecar + Shell plugin。能力等价，Electron 有现成 dugite 先例可抄。

### 1.6 License 汇总

| 组件 | License | 商用闭源 |
|---|---|---|
| Electron | MIT | ✅ |
| Tauri | MIT OR Apache-2.0 | ✅ |
| dugite / dugite-native | 工具链 MIT；产物内 git 随 GPLv2 分发 | ✅（子进程模式，GitHub Desktop 验证） |
| isomorphic-git | MIT | ✅ |

---

## 2. 对比矩阵 B：前端框架（React / Vue / Svelte）

| 维度 | React | Vue 3 | Svelte 5 | 对 NexNote 的权重 |
|---|---|---|---|---|
| 块编辑器内核可选面 | **最厚**：BlockNote（React 优先）、Lexical（官方 React 绑定）、Plate、Slate（React-only）；TipTap/ProseMirror 另有官方 React 绑定 | 薄：TipTap 官方一等支持；Lexical/Slate 仅社区绑定（lexical-vue） | **无**：无成熟块编辑器，TipTap 仅社区绑定 | **极高** |
| 图谱视图 | React Flow（官方）；sigma.js/cytoscape 框架无关兜底 | 无官方 React Flow 对应物；用 sigma.js/cytoscape 自封装 | Svelte Flow（同厂 xyflow） | 高 |
| dock / 多面板 | dockview-react（官方）、react-resizable-panels | dockview-vue（官方） | 无成熟 dock 库 | 高 |
| 单人 + AI 结对产出 | 语料与生态最大，AI 生成/排错最稳（经验判断） | 中 | 小 | 高 |
| 运行时开销/心智 | 较重、hooks 心智负担 | 轻、SFC 直观 | 最轻、编译期响应式 | 中 |
| 编辑器内核解耦余地 | TipTap/ProseMirror core 本身框架无关，UI 绑定层可换 | 同左 | 同左（但绑定层缺官方） | 高 |

### 2.1 块编辑器生态（一手证据）

- **BlockNote**（Notion 风格块编辑器，基于 ProseMirror+TipTap）：React 是其一等集成（`useCreateBlockNote` + `BlockNoteView`），vanilla 属"高级用户从头自建 UI"的用法（[官方 React Overview](https://www.blocknotejs.org/docs/react/overview)、[官方 Introduction](https://www.blocknotejs.org/docs)）。
- **Lexical**（Meta）：核心包框架无关，但**官方绑定仅 `@lexical/react`**；Vue 需第三方 `lexical-vue` / `vue-lexical`（社区项目，API 对齐 React 版属追赶状态）（[lexical.dev 官方包文档](https://lexical.dev/docs/packages/lexical)、[lexical#5435 社区讨论](https://github.com/facebook/lexical/discussions/5435)、[lexical-vue](https://lexical-vue.vercel.app/docs/introduction.html)）。
- **Slate**：官方定位即"a pluggable implementation of contenteditable **built on top of React**"，React-only（[Slate 官方文档](https://docs.slatejs.org/)）。
- **TipTap**：headless、框架无关，官方提供 React 与 Vue（2/3）绑定（[官方安装文档](https://tiptap.dev/docs/editor/getting-started/install)、[GitHub](https://github.com/ueberdosis/tiptap)）。
- **ProseMirror / ProseKit**：核心完全框架无关，是所有上述库的地基（[prosemirror.net](https://prosemirror.net/)、[ProseKit 多框架支持](https://prosekit.dev/getting-started/introduction)）。

### 2.2 图谱与多面板

- **sigma.js**：WebGL 大图渲染，官方声明框架无关（React/Angular/Vue/vanilla 皆可）（[v4.sigmajs.org](https://v4.sigmajs.org/)）；**cytoscape.js**：MIT、vanilla、生产广泛使用（[js.cytoscape.org](http://js.cytoscape.org/)）。→ 图谱底座不构成框架选型约束。
- **React Flow**（`@xyflow/react`）：节点图/白板交互官方 React 库，MIT（[reactflow.dev](https://reactflow.dev/)）；同厂 Svelte Flow 仅覆盖 Svelte（[xyflow](https://github.com/xyflow/xyflow)）。
- **dockview**：零依赖 dock 引擎，官方 React/Vue/Angular/TS 四绑定（[dockview.dev](https://dockview.dev/)、[license 对照](https://dockview.dev/docs/overview/licence)）。

### 2.3 单人维护面判断

- React：三个重度交互域（块编辑、图谱、dock）**全部有官方维护的现成方案**，组装量最小；且训练语料/社区规模最大，AI 结对生成与排错最稳定（经验判断，非量化结论）。
- Vue 3：TipTap + dockview-vue 可行，但块编辑器选项从"BlockNote/Lexical/Plate/Slate + TipTap"收窄为"TipTap（+ 社区 lexical-vue）"；图谱需 sigma.js 自封装绑定层。可行但每块都要多写一层。
- Svelte：块编辑器生态空白，直接排除。

---

## 3. 结论与建议

### 3.1 建议（供架构决策票引用）

1. **桌面壳：Electron（主选）**。决定性理由：三端单一 Chromium 引擎 → contenteditable/IME/拖拽/大 DOM 行为一致、可测、可锁版本；同赛道全部头部产品与 AFFiNE 回退先例背书；dugite 捆绑 git 模式现成；更新机制成熟且无"私钥断更"风险。接受代价：安装包 ~150–200 MB、内存偏高、Linux 无内置更新（AppImage/包管理器方案）。
2. **前端框架：React + TypeScript（主选）**。块编辑器、图谱、dock 三域官方方案齐备，单人组装面最小。
3. **架构留缝**：编辑器内核做成**框架无关的 ProseMirror/TipTap core 包 + 薄 React UI 绑定层**；壳层与前端之间只用标准 IPC（invoke/handler）通信。这样：换 Vue 只重写 UI 绑定层；未来若迁 Tauri 只重写壳层。
4. **Git 集成**：捆绑 dugite-native（Windows 必需，macOS/Linux 优先用系统 git 并回退捆绑）；GPLv2 合规按 GitHub Desktop 模式（随附 license + 源码指引）。isomorphic-git 不作主通道。

### 3.2 备选

- **壳备选：Tauri 2**——若后续产品对体积/内存/启动速度有硬指标，或要加移动端。前提是接受并验证：Linux IME（fcitx/ibus）实测、macOS 关闭 `fileDropEnabled` 后编辑器拖拽全量回归、三引擎测试矩阵。
- **框架备选：Vue 3 + TipTap**——仅当明确更熟悉 Vue 时；需接受块编辑器选择面收窄与图谱/面板自封装。

### 3.3 关键风险清单

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | Electron 体积/内存观感（营销对比劣势） | 低中 | 行业常态；懒加载、按需下载语言包 |
| R2 | Linux 自动更新无官方统一方案 | 中 | AppImage + AppImageUpdate，或仅提供 deb/rpm 仓库 |
| R3 | macOS 签名 + notarization 成本（两方案共有） | 中 | Apple Developer 账号；CI 公证流水线 |
| R4 | GPLv2 git 捆绑合规 | 低 | dugite-native 模式：随附 license 与源码指引 |
| R5 | Chromium 上游 IME/editor regression 波及 | 低 | Electron 锁定 Chromium 版本，升级前回归测试 |
| R6 | 若选 Tauri：Linux IME 长尾 + WKWebView 拖拽/composition bug + 三引擎测试面 | **高** | 选 Electron 即规避；坚持 Tauri 则需原型期专项验证 |

---

## 附：主要来源索引

官方文档/仓库：[Electron autoUpdater](https://electronjs.org/docs/latest/api/auto-updater) · [Tauri Updater](https://v2.tauri.app/plugin/updater/) · [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/) · [Tauri Windows Installer/WebView2](https://v2.tauri.app/distribute/windows-installer/) · [MS WebView2 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) · [electron-builder extraResources](https://www.electron.build/docs/contents) · [dugite-native](https://github.com/desktop/dugite-native) · [dugite](https://github.com/desktop/dugite) · [Electron License](https://github.com/electron/electron/blob/main/LICENSE) · [Tauri License](https://github.com/tauri-apps/tauri/blob/dev/LICENSE_APACHE-2.0) · [Git for Windows COPYING](https://github.com/git-for-windows/git/blob/HEAD/COPYING) · [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git)

Issue tracker（webview 实坑）：[tauri#5986](https://github.com/tauri-apps/tauri/issues/5986) · [tauri#11412](https://github.com/tauri-apps/tauri/issues/11412) · [tauri#15859](https://github.com/tauri-apps/tauri/issues/15859) · [tauri#3722](https://github.com/tauri-apps/tauri/issues/3722) · [wry#890](https://github.com/tauri-apps/wry/issues/890) · [wry PR#1724](https://github.com/tauri-apps/wry/pull/1724) · [WebKit bug 245783](https://bugs.webkit.org/show_bug.cgi?id=245783) · [WebKit PR#62264](https://github.com/WebKit/WebKit/pull/62264)

编辑器/前端生态：[BlockNote](https://www.blocknotejs.org/docs) · [Lexical](https://lexical.dev/docs/packages/lexical) · [Slate](https://docs.slatejs.org/) · [TipTap](https://tiptap.dev/docs/editor/getting-started/install) · [ProseMirror](https://prosemirror.net/) · [ProseKit](https://prosekit.dev/getting-started/introduction) · [React Flow](https://reactflow.dev/) · [sigma.js](https://v4.sigmajs.org/) · [cytoscape.js](http://js.cytoscape.org/) · [dockview](https://dockview.dev/)

竞品实证：[AFFiNE PR#935（上 Tauri）](https://github.com/toeverything/AFFiNE/pull/935) · [AFFiNE Desktop 现状（Electron）](https://toeverything-affine.mintlify.app/platforms/desktop) · [AFFiNE 社区帖 Why Shift](https://community.affine.pro/c/questions-answers/why-shift-from-tauri-to-electron) · [Logseq 源码](https://github.com/logseq/logseq) · [SiYuan 架构](https://deepwiki.com/siyuan-note/siyuan/4.1-application-bootstrap-and-window-management)

第三方基准（量级参考、非官方）：[johal.in 打包体积](https://johal.in/tauri-20-vs-electron-30-desktop-app-bundle) · [johal.in 内存/性能](https://johal.in/benchmarks-performance-tauri-20-vs-electron-30-markdown)
