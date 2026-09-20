# DEV-068 · 翻译默认目标语言跟随设置常规界面显示语言

Type: dev
Module: settings
Status: ready-for-agent
Blocked by: 无
Depends: 无
Effort: S
Priority: P2

## What to build

临时翻译（划词翻译、全文翻译）的"默认目标语言"目前由两层 fallback 组成：
1. AI 设置里的 `translationTargetLanguage` 全局默认（如未设置）；
2. `guessTargetLanguage(text)`：CJK 比例 > 20% 时 → `'English'`，否则 → `'简体中文'`。

用户期望"设置常规 → 界面显示语言"成为优先级最高的默认值：当用户把界面切到 `English` 时，新发起的翻译会话应当默认选 English，而不是按原文猜语种。

triage 定位到的代码点：
- `features/ai/translation/languages.ts:64` 的 `resolveInitialTargetLanguage(text, globalDefault)`：仅看 `globalDefault` + `guessTargetLanguage(text)`，不读 i18n 暴露的界面语言。
- AI 设置面板 `features/ai/AiSettingsSection.tsx`：持久化字段里没有 UI 界面语言字段；界面显示语言信息存在于 i18n 配置中（具体模块由 agent 探索时确认）。

修复方向（agent 决定具体接入点，验收标准不变）：
1. 在 i18n 模块暴露可读接口（如 `getInterfaceLanguage()` 或 `useInterfaceLanguage()`），输出当前生效的界面语言 tag（如 `zh-CN` / `en-US` / `ja-JP`）。
2. `resolveInitialTargetLanguage` 优先级调整为：**全局默认 > 界面语言映射（`zh* → '简体中文'`、`en* → 'English'`、`ja* → '日本語'`、`ko* → '한국어'` …）> `guessTargetLanguage(text)`**。
3. 在翻译 workbench 渲染时，所选默认值若因新逻辑变化需保持当前进行中会话的语言不变（避免打断）。
4. 优先级映射表写在 `languages.ts` 里集中维护，避免散落到 controller。

约束：
- 不影响用户在临时会话里主动切换目标语言的能力（`onChangeLanguage` / `setTargetLanguage` 行为不变）。
- 不引入新的设置 UI 控件；复用现有 i18n 与 AI 设置持久化。
- 不改 `guessTargetLanguage` 的兜底语义；只在缺全局默认时使用界面语言映射。

## Acceptance criteria

- [ ] 单元测试覆盖 `resolveInitialTargetLanguage` 的三档优先级：全局默认 > 界面语言映射 > `guessTargetLanguage`。
- [ ] 用户在设置常规切换界面语言后，新发起的翻译会话默认目标语言随之改变（不重启进程）；进行中的会话不变。
- [ ] 翻译 workbench 顶部下拉默认值随设置变更刷新；切换语言、暂停、关闭等运行时行为不回归。
- [ ] 与既有 AI 设置 `translationTargetLanguage` 全局默认共存（若显式设置，仍以显式值为准）。
- [ ] 不引入新的 UI 元素，不修改 AI 设置面板文案；仅改动 `controller.ts` / `languages.ts` / i18n 暴露接口 / 单测。
- [ ] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
