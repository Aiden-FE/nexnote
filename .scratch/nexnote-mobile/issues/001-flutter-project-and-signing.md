# MOB-001 Flutter 工程与 iOS 签名基线

Ticket: MOB-001 · Milestone: M1 · Branch: dev/MOB-001 · Depends: —
ADR: docs/adr/0017-mobile-flutter-client.md
Status: open

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
