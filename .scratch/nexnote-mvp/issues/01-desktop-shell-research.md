# 01 · 桌面壳与前端框架选型研究

Type: research
Status: resolved

## Question

为 NexNote 的桌面壳与前端框架组合提供事实依据（约束：单人 + AI 结对、对外产品标准、Win/macOS/Linux 三端、编辑器重度应用）：

1. Tauri vs Electron：跨平台打包与体积、自动更新机制、进程模型 / sidecar 能力、系统 webview 差异对复杂编辑器（contenteditable、大 DOM、拖拽）的实际坑、与外部 git 二进制及"捆绑 git"的集成路径、license。
2. 前端框架（React / Vue / Svelte 等）对块编辑器 + 多面板 + 图谱视图这类重度交互前端的生态适配与单人维护面。

产出对比矩阵 + 明确建议（含备选）与关键风险。

## Answer

**报告**：[docs/research/desktop-shell.md](../../../docs/research/desktop-shell.md)

**要点**：1) 编辑器重应用的第一优先级是三端渲染引擎一致——Electron 锁单一 Chromium，Tauri 三端三种引擎且各有 contenteditable/IME/拖拽长尾坑（Linux WebKitGTK IME bug 链、macOS WKWebView 默认拦截 DOM 拖拽、WebKit composition 事件顺序 bug，均有 issue 实证）。2) 同赛道全 Electron：Obsidian/Logseq/SiYuan/AFFiNE/GitHub Desktop；AFFiNE 2022 上 Tauri、2023 切回 Electron。3) 自动更新：Electron 内置（Linux 除外）；Tauri 强制签名、丢私钥即断更。4) 捆绑 git：dugite-native（GitHub Desktop 闭源商用先例）+ GPLv2 随附分发即可，两条壳集成路径等价。5) 前端框架：React 在块编辑器（BlockNote/Lexical/Plate/Slate + TipTap 官方绑定）、图谱（React Flow）、dock（dockview-react）三域官方方案齐备；Vue 收窄到 TipTap；Svelte 无块编辑器生态。6) 体积/内存为 Tauri 唯一显著优势，第三方基准约 14MB vs 187MB，但行业同赛道产品均接受 Electron 量级。

**建议**：**Electron + React + TypeScript**；编辑器内核独立为框架无关的 ProseMirror/TipTap core 包 + 薄 React 绑定层，壳层仅经标准 IPC 通信（保留换壳/换框架余地）。**备选**：壳 = Tauri 2（接受 Linux IME 实测 + 三引擎回归测试前提）；框架 = Vue 3 + TipTap（块编辑器选择面收窄）。**最大风险**：选 Tauri 则 Linux IME 与 WKWebView 拖拽为高风险项；选 Electron 则体积观感与 Linux 自动更新方案为主要代价。
