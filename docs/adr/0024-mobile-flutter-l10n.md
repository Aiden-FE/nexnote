---
status: implemented
---

# 手机端界面双语：Flutter 官方 l10n，提交摘要不本地化

手机端（`apps/mobile`，Flutter）与桌面端一样是纯中文硬编码：无 `flutter_localizations`、无 `intl`、无 `l10n.yaml` 或 `.arb`，iOS 工程只有 `Base.lproj`，`knownRegions` 无 `zh-Hans`。用户要求界面双语，故与桌面端（ADR-0023）同批实现。

真实规模比行数显示的小得多：510 行含 CJK 的代码中 345 行（67.6%）是文档注释，真实用户向字符串约 162 行 / 167 处，集中于设置页（37）、块编辑器、阅读页与源码编辑器；UI 断言集中在 3 个测试文件共 32 行。本机 Flutter 3.47.3 / Dart 3.13.3 已就绪，与 `pubspec.yaml` 的 `sdk: ^3.13.3` 匹配。因此采用 Flutter 官方方案：`flutter_localizations` + `intl` + `generate: true` + `lib/l10n/*.arb`（zh-Hans / en），并在 iOS 工程补 `CFBundleLocalizations` 与 `knownRegions`。

## Considered Options

- **自研 Dart 字符串常量表**：省掉代码生成，但放弃 `GlobalMaterialLocalizations`（日期、系统组件文案）并需自建语言切换与回退；否决，桌面端的轻量取向来自「无现成基建」这一不同前提。
- **只做核心页面、其余留中文**：与 ADR-0023 同理，会留下半个假开关；否决。
- **本地化写入 Git 的提交摘要**（`保存页面` / `创建页面` / `删除页面`）：会让同一知识库的提交历史随界面语言漂移，也与桌面端 `nexnote:auto:` / `nexnote:manual:` 前缀语义脱节；否决，提交摘要属写入仓库的用户数据。

## Consequences

- 手机端的界面语言与桌面端一致按系统语言初始化并可覆盖；两端词典各自维护（Flutter arb 与 TS 消息目录不共享文件），术语以 CONTEXT.md 为准，需两端各自校对。
- 需要生成 iOS 的 `zh-Hans` 本地化区域；未在真机或模拟器验证系统语言切换前，相关验收标记为 `NOT_RUN`。
- 3 个测试文件的 UI 断言改为经本地化查找，不得硬编码中文文案。
- 与 ADR-0023 边界一致：AI 提示词不属界面文案。

## Implementation Notes（2026-10-09 落地）

- 采用 Flutter 官方方案：`flutter_localizations` + `intl` + `generate: true` +
  `lib/l10n/{app_zh.arb,app_en.arb}`（各 161 个 key，逐 key 对齐，由
  `l10n_message_catalog_test.dart` 锁定）；`AppLocalizations` 生成文件入库。
- 界面语言：`AppSettings.languageOverride`（仅接受 zh/en，其余按 null 处理）+
  `AppServices.localeOverride`，设置页以 `SegmentedButton` 提供
  跟随系统 / 简体中文 / English；`MaterialApp.locale` 为 null 时跟随系统，
  系统语言既非 zh 也非 en 时按 `supportedLocales` 首项回退 en。
- 错误码化（与 ADR-0023 同模式）：`SyncMessageKind` / `GitErrorCode` /
  `AiRequestErrorCode` / `SecretVaultErrorCode` / `CaptureErrorCode` 为语言中性码，
  界面经 `app/message_descriptions.dart` 成文；Git 自带错误不再携带面向用户的中文，
  仅保留 libgit2 原生 detail 作诊断。
- 按本 ADR 否决项保留中文：Git 提交摘要（`保存页面` 等）、AI system prompt
  （含 `RecallStage.promptLabel`，显式区分于界面用的 `describeRecallStage`）、
  快速捕获落盘标题（`未命名捕获`，UI 侧靠 `generatedTitle` 标志本地化）、
  内部开发异常（`VaultPathError` / `ArgumentError`）与代码注释。
- iOS：`Info.plist` 加 `CFBundleLocalizations`（`zh-Hans` / `en`），
  `project.pbxproj` 的 `knownRegions` 加 `zh-Hans`。
- 门禁：`flutter analyze` 无问题；`flutter test` 120 例通过；
  `l10n_message_catalog_test.dart` 以 CJK 正则扫描锁定「EN 词典无中文残留」。
- `NOT_RUN`：iOS 真机 / 模拟器上的系统语言切换与 Keychain 写入未在本机验证
  （本机无 iOS 运行时），需在具备 Xcode 模拟器或真机的环境补验。
