# 06 · 插件系统机制研究

Type: research
Status: claimed

## Question

为 NexNote 插件系统（第三方可扩展块类型、视图、菜单、命令；用户本地安装；对外产品标准需 API 稳定性）提供机制事实依据：

1. 沙箱 / 运行时选项对比：iframe + postMessage、Web Worker、QuickJS / WASM、Node 子进程（桌面壳下）——安全边界、能力暴露、性能、与「扩展块类型」（需要注册编辑器节点）的匹配度。
2. 参考对象：Obsidian 插件 API（桌面全能力模式的取舍与安全争议）、AFFiNE / BlockSuite 扩展机制、tldraw 插件 / util 体系、VS Code 扩展 API 分层。
3. 本地安装格式：manifest 字段、版本策略、入口约定、签名 / 安全基线的行业做法。
4. 插件 API 与编辑器内核（02 号票的候选）的耦合面：哪种内核的扩展点最适合被第三方安全调用。

产出运行时建议 + API 分层草案要点。
