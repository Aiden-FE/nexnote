---
status: in_progress
---

# 官网截图的平台口径：先交付 macOS，其余平台标注而非阻塞

官网文档要配真实产品截图，且 ADR-0010 已规定截图必须来自专用**演示知识库**（Demo Vault），禁用冒烟种子数据截图。用户希望覆盖 macOS、Windows、Linux 三平台，但当前工作站的事实是：macOS 可行（存在可启动的 0.0.29 arm64 `.app`，仓库已有 `webContents.capturePage()` 自动截图链路）；**Windows 不可行**（本机无任何 Windows 运行时）；**Linux 不可行**（唯一 Linux 环境为无图形栈的 aarch64 Colima 虚拟机，且官方产物为 x86_64）。决定：本次交付 macOS 全套截图并上官网，Windows/Linux 文档页复用同一组 macOS 截图并在页面明确标注「截图以 macOS 为准，各平台功能一致」，跨平台截图作为后续项等环境就绪再补拍。

## Considered Options

- **阻塞截图交付，等 Windows/Linux 运行环境**：让一个不存在的运行时挡住整条文档工作流，代价不成比例；否决。
- **用 `.scratch/nexnote-build/smoke/` 现有截图占位**：内容为调试种子数据（vault 名 `smoke-vault`、页面名「冒烟页面 A」、500 个机械命名节点），ADR-0010 明令禁止；否决。
- **只发 macOS 截图、不做任何跨平台说明**：用户会误以为产品只有 macOS 形态或在其他平台外观不同；否决，改为显式标注。

## Consequences

- 演示知识库须新建：一套知识库、中文为主穿插英文页面（真实双语用户的样子），两语文档共用同一组截图；嵌套在 monorepo 内可行，唯一硬约束是它必须自带独立 `.git`（否则应用拒绝打开）。
- 官网文档在截图说明处需呈现平台标注，不得暗示三平台截图均已核验。
- 未实际拍摄的平台不得声称已验收；跨平台截图与 en-US 界面重截均为已登记的后续项。

## Progress（2026-10-09）

- 演示知识库已建成 `docs/demo-vault/`：自带独立 `.git`、中英双语示例页面、双链与标签关系真实。
  作为本地截图资产按 ADR-0025 硬约束处理（自带独立 `.git`，不入外层仓库，见 `.gitignore`）。
- macOS 截图：本轮执行时 Mac 进入锁屏，GUI 自动化无法解锁而被阻塞（`NOT_RUN`）；
  待解锁后的图形会话中启动打包应用打开演示库并经 `capturePage` 截图。
- 官网文档页的截图引用与「截图以 macOS 为准，各平台功能一致」标注待截图产出后落地。

## Progress（2026-10-12）

### CTA 与文档站实拍已完成

- 解锁后的图形会话中，用独立 `--user-data-dir` 预置 `lastVaultPath` 与
  `nexnote-ai.json`（`setupPromptDismissed: true`，绕开首启 AI 弹窗）启动了
  打包应用 `release/mac-arm64/NexNote.app`（v0.0.34）并打开 `docs/demo-vault`。
- **DEV-103 核心 CTA 实拍验收**：欢迎页「快速上手」按钮点击后，系统默认浏览器
  （Google Chrome）打开 `https://website-aiden-fes-projects.vercel.app/zh/docs/getting-started`，
  标题为「快速上手 · NexNote 文档」，符合「用系统默认浏览器打开对应语言文档页」的决定。
- 文档站实拍：`/zh/docs/getting-started` 完整渲染 11 章侧栏、页内目录、正文表格
  与「适用版本 v0.0.29+」标注。**用户此前报告的「文档无图例」经实拍核查为当前设计
  边界**：文档渲染器（`apps/website/src/docs/markdown.ts`）按 ADR-0010 只支持文本、
  表格、代码块与双链语法，不解析 `![](...)` 图片语法。
- 已产出并落盘两张 macOS 实拍资产（2000px 宽，供后续评审/部署用，暂未嵌入正文）：
  - `apps/website/public/screenshots/macos-welcome-zh.png`（欢迎页 + 页面树 + 快速上手 CTA）
  - `apps/website/public/screenshots/docs-getting-started-zh.png`（文档快速上手页全貌）

### 仍未完成

- **应用内容页（编辑器/图谱/设置/插件等）截图**：本次 GUI 自动化中，侧边栏文件树的
  点击与 Tab 导航焦点在 Electron 渲染进程与浏览器之间反复漂移（前台被其他应用抢占、
  窗口位置漂移、Tab 焦点跳出到 Chrome），未能在打包应用中稳定打开
  `notes/Reading Notes` 等内容页。按本 ADR「未实际拍摄的平台/页面不得声称已验收」的边界，
  这些页面保持 `NOT_RUN`，不放入任何有瑕疵的截图作为验收证据。
- en-US 界面重截、macOS 全套页面截图、Windows/Linux 截图仍待后续环境就绪补拍。
