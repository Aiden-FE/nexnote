# ADR-0017 手机端采用 Flutter 独立客户端

- 状态：accepted（其中「手机端不执行 Git 运算」条款由 ADR-0018 修订）
- 日期：2026-09-30

## 背景

桌面端为 Electron + React，编辑器内核 `packages/kernel`（TipTap/ProseMirror）依赖浏览器 DOM；ADR-0001 预留的「换壳余地」以 Web 技术栈为前提。移动端选型时，Capacitor 复用 Web UI 与 Flutter 原生实现两条路线并存，后者意味着 UI 与编辑器完全重写。

## Decision

手机端用 Flutter 独立实现（iOS 优先），不复用 `packages/renderer` 与 `packages/kernel`；跨端复用收敛到契约/协议层。桌面端保持 Electron 并作为知识库权威端承担全部 Git 运算，手机端不执行 Git 运算。

## Considered Options

- **Capacitor 打包现有 Web UI**：可复用 React renderer，但 `better-sqlite3`、`dugite`、`@napi-rs/keyring` 等原生能力层仍需跨端重写，且长期背负 Web/原生双运行时的维护面。
- **Tauri Mobile**：块编辑器在三引擎 WebView 下的长尾风险未消除（同 ADR-0001 结论）。
- **Swift/Kotlin 双端原生**：成本更高，且同样无法复用现有内核。

## Consequences

- 手机端编辑器需在 Dart 侧重建，「基础编辑」的边界需另行约束（后续 ADR 或 ticket）。
- ADR-0001 的「壳层仅经标准 IPC 通信」复用承诺，在移动端兑现为「手机端经网络 API 访问权威端」；现有 152 条 IPC 契约作为 API 设计蓝本。
