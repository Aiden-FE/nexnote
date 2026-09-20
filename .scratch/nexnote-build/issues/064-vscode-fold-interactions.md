# DEV-064 · VS Code 风格标题折叠呈现与快捷键

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: DEV-061（统一外部 gutter 几何）
Depends: DEV-054、DEV-055、DEV-056（既有折叠入口与目录 reveal）
Effort: L
Priority: P0

## What to build

标题折叠的呈现与交互对齐 VS Code：折叠标题不再整体变灰；折叠与展开状态的常显差别主要是 gutter chevron 方向与标题行尾可点击省略号；悬停折叠标题时在标题行内联显示被隐藏章节的淡色 ghost preview，点击 preview 或省略号展开。块编辑与 Markdown 源码模式保持同一折叠语义和交互。提供当前章节折叠/展开/切换快捷键和“折叠到 H1/H2/H3”命令；不提供无差别 Fold All。

用户视角的完成标准：折叠后的标题不再是一串发灰的平铺标题；hover 能预览被折叠内容；单击行尾 `…` 即可展开；快捷键与命令面板可直接折叠/展开当前章节或按层级折叠。

## Acceptance criteria

- [ ] 块编辑与源码模式折叠态常显差异统一为 chevron 方向 + 行尾可点击省略号；不再通过降低整个标题透明度表达折叠。
- [ ] 块编辑折叠标题有行尾省略号；源码模式已有省略号升级为可点击展开，两模式行为一致。
- [ ] 悬停折叠标题时出现内联 ghost preview，展示被隐藏章节内容；preview 淡色、不可编辑、随 hover 消失。
- [ ] 点击 ghost preview 或省略号展开当前章节。
- [ ] 增加折叠当前章节、展开当前章节、切换当前章节快捷键，支持 Ctrl/Cmd 平台差异；如实现 chord，需与既有快捷键系统协调且不破坏 `Mod+K` 命令面板。
- [ ] 命令面板新增“折叠当前章节”“展开当前章节”“折叠到 H1/H2/H3”。
- [ ] 明确不提供无差别 Fold All；延续 ADR-0013 的批量折叠边界。
- [ ] 折叠状态仍是临时编辑视图状态，不写正文或 sidecar；目录跳转/查找 reveal 语义不回归。
- [ ] 六门禁通过；自动化测试覆盖快捷键、命令、placeholder/ghost DOM 与 ARIA。

## Blocked by

DEV-061（统一外部 gutter 几何）。

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
