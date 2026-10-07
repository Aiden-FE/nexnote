---
status: accepted
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
