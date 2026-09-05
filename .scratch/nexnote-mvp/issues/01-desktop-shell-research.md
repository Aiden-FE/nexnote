# 01 · 桌面壳与前端框架选型研究

Type: research
Status: claimed

## Question

为 NexNote 的桌面壳与前端框架组合提供事实依据（约束：单人 + AI 结对、对外产品标准、Win/macOS/Linux 三端、编辑器重度应用）：

1. Tauri vs Electron：跨平台打包与体积、自动更新机制、进程模型 / sidecar 能力、系统 webview 差异对复杂编辑器（contenteditable、大 DOM、拖拽）的实际坑、与外部 git 二进制及"捆绑 git"的集成路径、license。
2. 前端框架（React / Vue / Svelte 等）对块编辑器 + 多面板 + 图谱视图这类重度交互前端的生态适配与单人维护面。

产出对比矩阵 + 明确建议（含备选）与关键风险。
