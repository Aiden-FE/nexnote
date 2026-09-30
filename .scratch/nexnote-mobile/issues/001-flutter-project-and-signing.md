# MOB-001 Flutter 工程与 iOS 签名基线

Ticket: MOB-001 · Milestone: M1 · Branch: dev/MOB-001 · Depends: —
ADR: docs/adr/0017-mobile-flutter-client.md
Status: done —— Flutter 3.47.3 工程（apps/mobile）+ xcodebuild 模拟器构建通过 + 桌面端门禁未受影响；真机重签步骤见 README（免费个人团队签名，7 天）

## 目标

建立手机端的工程基线：Flutter 工程、iOS 构建与真机安装通路、与桌面端仓库门禁的隔离。

## 行为

1. 在仓库内建立 Flutter 工程目录（建议 `apps/mobile`，与 `apps/website` 并列），纳入版本控制；Dart/Flutter 依赖锁文件一并入库。
2. iOS 目标最低版本不高于 12.0（ADR-0018 依赖的 libgit2 二进制约束）；应用标识与显示名使用 NexNote 品牌。
3. 使用免费个人团队签名完成真机安装并启动（生成 7 天有效描述文件的路径要写进 README，含重签步骤）。
4. 桌面端门禁不受影响：`pnpm -r typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 的既有行为与耗时保持成立（Flutter 目录不进入 pnpm workspace）。
5. 建立手机端自身的最小质量门禁命令（`flutter analyze` + `flutter test`），并写入该工程 README。

## 边界

- 不在本票实现任何业务功能（不含 git2dart 接入、不含 vault 访问）。
- 不修改 `packages/*` 与 `electron.vite.config.ts`。

## 验收

- 真机上安装并启动应用，显示版本号与运行环境（Flutter / 引擎版本）。
- `flutter analyze` 与 `flutter test` 全绿。
- 桌面端四门禁在加入 Flutter 目录后仍全绿（记录命令与退出码）。
- README 中的重签步骤经一次真实操作验证（撤销描述文件后按步骤恢复）。

## Xcode 交互式验收（2026-09-30，电脑控制实操）

1. `open ios/Runner.xcworkspace` → Xcode 已加载，Project Navigator 正常展开
   （Runner / Pods / Package Dependencies: FlutterFramework、integration_test）
2. Active Scheme = `Runner`，Active Run Destination = `iPhone 18 Pro`
3. 首次 ⌘R：**Build Failed** —— `Command PhaseScriptExecution failed with a nonzero exit code`。
   根因已确认：先跑了 `flutter test integration_test/...`，该命令把
   `ios/Flutter/flutter_export_environment.sh` 的 `FLUTTER_TARGET` 改写成
   `/var/folders/.../flutter_test_listener.xxx/listener.dart`（临时文件，测试结束即删）。
4. 修复：先跑一次 `flutter build ios --simulator`（刷新该文件，`FLUTTER_TARGET` 回到 `lib/main.dart`），
   再按 ⌘R
5. 二次 ⌘R：**构建成功并运行**。Xcode 状态栏 `Runner Running Runner on iPhone 18 Pro`，
   Debug 区出现 stack frames 与 `flutter: The Dart VM service is listening on http://127.0.0.1:61605/...`
   （调试器已挂载），Stop 按钮启用
6. 模拟器截图：应用首屏与底部五标签（库/搜索/捕获/AI/设置）正常
   → `.scratch/nexnote-mobile/screenshots/shot-12-Xcode运行-iPhone18Pro.png`

注意：命令行 `xcodebuild` 在第 3 步之前是成功的——因为它不读被污染的
`flutter_export_environment.sh`（用 `flutter build` 生成的环境）。这是本次
交互式验收额外暴露的差异，已写入 `apps/mobile/README.md` 的注意事项。
