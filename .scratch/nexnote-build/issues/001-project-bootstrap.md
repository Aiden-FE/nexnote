# DEV-001 · 项目骨架与 Electron 主进程

Type: dev
Module: foundation
Status: closed
Blocked by: (none)
Depends: (none)
Effort: M
Priority: P0

## Scope

搭建 NexNote 桌面应用工程骨架，打通主进程 ↔ 渲染进程 IPC、vault 根目录管理、窗口生命周期。

### 交付内容
1. **工程脚手架**
   - monorepo 结构（建议 pnpm workspace）：`packages/main`（Electron 主进程）、`packages/renderer`（React 渲染层）、`packages/shared`（类型/协议）、`packages/kernel`（编辑器内核，框架无关）
   - TypeScript strict + ESLint + Prettier
   - TailwindCSS + shadcn/ui 基础配置（渲染层）
   - electron-builder 打包配置（macOS / Windows / Linux 三端）
   - 自动更新骨架（electron-updater，预留签名位）

2. **Electron 主进程基础**
   - 单实例锁、窗口管理（主窗口 + 未来子窗口预留）
   - 安全基线：contextIsolation + sandboxed preload + 最小化 nodeIntegration
   - IPC 通道基础框架：命名空间化（`vault:*`、`editor:*`、`git:*`、`ai:*`、`plugins:*`）+ 类型化 DTO（shared 包）
   - 文件系统能力封装（主进程侧），渲染层只能通过 IPC 调用

3. **Vault 管理**
   - vault 根目录概念（一个窗口 = 一个 vault）
   - 首启动向导三选一骨架（新建空 vault / 打开本地文件夹 / 克隆远程仓库）——UI 占位，克隆功能移 DEV-007
   - vault 配置文件（`.nexnote/config.json`）存储窗口布局、上次打开等
   - 最近打开 vault 列表

4. **渲染层应用壳**
   - 基础窗口布局：侧栏（可折叠）+ 主内容区 + 右侧 dock 占位 + 底部状态栏占位
   - 主题系统（亮/暗，CSS 变量桥接 shadcn/ui 与未来 TipTap 样式）
   - 多 Tab 骨架 + 分屏骨架（左右各一个 pane，每个 pane 一个 tab stack）
   - ⌘K 命令面板骨架（仅 UI + 扩展点注册机制，无具体命令）

## 关联决策
- 技术栈默认案：[ADR 0001](../../nexnote-mvp/docs/adr/0001-default-tech-stack.md)
- 产品架构信息架构：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 桌面壳选型研究：[desktop-shell.md](../../nexnote-mvp/docs/research/desktop-shell.md)

## 关联原型区域
- 整体窗口框架、侧栏、Tab、分屏、状态栏、⌘K 骨架 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（外壳结构）

## 验收标准
- 应用可启动，显示三面板布局（侧栏 + 主区 + 右侧 dock）
- 可通过首启动向导创建空 vault 或打开已有文件夹
- 多 Tab 可打开/关闭，分屏可拖拽分隔线
- ⌘K 可唤起，可注册新命令
- 亮/暗主题切换正常
- electron-builder 可打出至少 macOS dmg
