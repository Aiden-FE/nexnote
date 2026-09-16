# NexNote

[![PR checks](https://github.com/Aiden-FE/nexnote/actions/workflows/pr-check.yml/badge.svg)](https://github.com/Aiden-FE/nexnote/actions/workflows/pr-check.yml)

**NexNote 是一款本地优先的知识库桌面应用，把笔记、双链、Git 历史与可控 AI 工作流放在同一个知识库中。**

块编辑 × Markdown × 双链 × Git × 可控 AI。

[English](README.md) · [下载最新版本](https://github.com/Aiden-FE/nexnote/releases/latest) · [GitHub](https://github.com/Aiden-FE/nexnote)

## 为什么是 NexNote

NexNote 将知识库保存在本地，以 Git 仓库承载普通文件。你可以使用结构化块编辑，也可以保留 Markdown 原文；通过 `[[双链]]` 连接页面，查看反向链接与图谱，并且只有在明确请求时才让 AI 参与工作。

## 功能

- **双格式文档** — 结构化块编辑与逐字节保真的 Markdown 源码视图。
- **Markdown 三视图** — 源码、可拖拽调整宽度的源码+实时预览分栏，以及纯只读预览视图。
- **知识网络** — 双链、反向链接、别名、标签、图谱与支持中文的全文搜索。
- **Git 历史** — 自动提交、版本时间线，以及由修订历史计算的置信度信号。
- **可控 AI** — OpenAI 兼容供应商、本地 embedding、显式 AI 意图、流式结果与权限模式。
- **可扩展桌面端** — 通过显式能力授权的沙箱插件。

## 下载

当前提供以下桌面端构建：

- macOS — Apple Silicon 与 Intel
- Windows — x64
- Linux — x64

[从 GitHub Releases 下载](https://github.com/Aiden-FE/nexnote/releases/latest)。平台安装说明见 [FAQ](docs/faq.md)。发布产物可能需要手动确认 Gatekeeper 或 SmartScreen；除非某个版本明确记录，项目不宣称已签名或已公证。

## 隐私与控制

知识库留在本地，NexNote 没有账号，也没有自有云端后端。供应商密钥存放在系统钥匙串中。普通编辑、保存、导航和选区变化不会产生 AI 请求；AI 动作必须由用户明确触发，并遵循当前权限模式。

## 本地开发

环境要求：Node.js 22 与 pnpm 10。

```sh
pnpm install
pnpm dev

pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

仓库采用 pnpm monorepo：

- `packages/kernel` — 编辑器与 Markdown 内核
- `packages/renderer` — Electron renderer 与 UI
- `packages/main` — Electron 主进程与 IPC
- `packages/shared` — 共享类型与领域逻辑
- `packages/plugin-api` — 插件契约
- `apps/website` — 产品官网与原型 Gallery

产品词汇见 [CONTEXT.md](CONTEXT.md)，架构决策见 [docs/adr](docs/adr)。当前交付票据位于 `.scratch/nexnote-build/issues/`。

## 贡献

提交变更前请运行 lint、typecheck、test 与 build 门禁。用户可见术语需与 `CONTEXT.md` 保持一致；难以逆转或没有上下文就难以理解的决策，应新增或修订 ADR。

## License

应用代码使用 [MIT License](LICENSE)。打包桌面应用同时包含捆绑的 Git 组件，其 GPLv2 声明与源码提供材料保存在 [`licenses/`](licenses/) 中。
