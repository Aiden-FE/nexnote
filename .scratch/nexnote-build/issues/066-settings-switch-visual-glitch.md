# DEV-066 · 设置页 Switch 启用态 thumb 视觉错乱修复

Type: dev
Module: settings
Status: ready-for-agent
Blocked by: 无
Depends: 无
Effort: S
Priority: P1

## What to build

设置界面所有 `role="switch"` 的 Toggle 开关在启用态下出现"白色圆圈溢出区域、样式错乱"的视觉缺陷。根因排查与修复由 agent 完成，用户视角的完成标准是：设置页每个 Toggle 在浅色与深色主题、启用与禁用四个象限下，thumb 圆圈都完整落在轨道内部，无溢出、无阴影怪异、无与轨道同色导致"消失"的错觉。

triage 定位到的代码点：`packages/renderer/src/features/settings/index.tsx:126-144`（`Toggle` 组件）。triage 分析出的可疑因素（agent 需逐一验证并修复确认项）：

- dark 模式下 `--primary`（`oklch(0.922 0 0)`，接近全白）与 thumb `bg-white` 几乎同色，thumb "消失"，只剩阴影 → 视觉上像错乱/溢出。
- thumb `shadow`（Tailwind 默认 `box-shadow`）在无 `overflow-hidden` 轨道约束下外扩到轨道外，被感知为溢出。
- thumb 定位 `absolute top-0.5` + `translate-x-4`：验证启用态右缘与轨道右缘的实际间距是否如预期（理论 4px 余量）。

修复方向由 agent 依据验证结果决定，最小侵入即可：例如轨道加 `overflow-hidden`、thumb 阴影改为更小的 `shadow-sm`、dark 模式启用态 thumb/轨道对比度调整等组合。

## Acceptance criteria

- [ ] 复现脚本或截图证据先落 worklog，确认当前缺陷的实际视觉表现（浅色/深色、启用/禁用）。
- [ ] 设置页所有 Toggle（含 GeneralSection、AI、Git、插件、快捷键页共 7 处 `<Toggle`）在浅色/深色 × 启用/禁用四象限下 thumb 完整位于轨道内、无阴影外扩、无同色不可辨。
- [ ] `role="switch"`、`aria-checked`、键盘触发（Enter/Space）行为不回归。
- [ ] 不引入设置页之外的全局 CSS 副作用（修改只作用 Toggle 组件自身类名或新增局部样式）。
- [ ] 六门禁通过；若新增局部样式文件，补充对应快照/DOM 测试。

## Blocked by

None (can start immediately).

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
