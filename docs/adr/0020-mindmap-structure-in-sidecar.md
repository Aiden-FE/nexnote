# ADR-0020 mindmap 布局结构的存储与自定义布局归属

- 状态：accepted
- 日期：2026-10-07
- 触发 ticket：DEV-102

## 背景

用户要求 xmind 编辑器支持六种布局结构：向右分支（默认）、向左、向上、向下、四向鱼骨，以及仅根节点可用的 X 结构（子节点 ≥ 2 时启用，启用后一级子节点分置左上/右上/左下/右下四个象限；恰为 2 个时退化为左右形式）。

调查结论（simple-mind-map 0.14.0）：

- `logicalStructure` / `logicalStructureLeft` / `fishbone` / `fishbone2` / `organizationStructure` 为库内可用，可通过 `setLayout` 切换。
- 任何布局都不支持"向上"生长：`organizationStructure` 硬编码向下（`OrganizationStructure.js:50-52`），`CONSTANTS.DIR.UP` 从未进入布局代码。
- `rightFishbone` / `rightFishbone2` 是死枚举：在常量表里存在，但 `Render.js` 的 `layouts` 映射表没有 entry（`Render.js:46-71`），`setLayout` 会静默降级为向右逻辑结构——因此库内没有左向鱼骨。
- xmind 字节里的 `structureClass` 在 NexNote 的解析端被完全丢弃，写回端对每个 topic 硬编码 `org.xmind.ui.logic.right`（`xmind-convert.ts:246`），`zip-preserve.ts` 又把它划归"重建方拥有"——即使把结构写进字节，外部 XMind 也看不到一致的布局。
- sidecar（`.nexnote/metadata/<base64url>.json`）已随 Git 跨设备同步（DEV-100），当前承载 `mindmapTheme`，是现成的逐文档设置通道。

## Decision

1. **布局结构存 sidecar，不写 xmind 字节**。字段名 `mindmapStructure`，与既有 `mindmapTheme` 同构（`document:getMetadata` 读、`binary:mindmapStructure:set` 写）。v1 明确不承诺"外部 XMind 打开时布局一致"。
2. **"向上"与"X"自研**，实现为新的布局类挂在 renderer，遵循 `Base` 契约（`doLayout` / `renderLine` / `renderExpandBtn`）。注册途径不动 `node_modules`：`Render.setLayout` 的查找链 `layouts[name] || mindMap[name]` 允许把类挂到实例上注入；`opt.layout` 与 `setLayout` 的 `layoutValueList` 白名单需要拦截补丁（narrow 范围的 monkey-patch，集中在 `mindmap-layouts/` 内）。
3. **"四向鱼骨"采用库内 `fishbone`**（主轴向右、一级分支在主轴上下交替），不做超出该算法的四象限同向鱼骨。UI 命名不做"向右"前缀，参照语雀画板面板惯例。
4. **X 结构仅在根节点子节点 ≥ 2 时可选**；< 2 时菜单项置灰。选中 X 后子节点掉回 < 2 的，画布保持最后一次有效分布，菜单项相应置灰——不自动回退并改写用户的结构选择；恰为 2 个时退化为左右形式。
5. **切换结构不写节点 data、不进撤销历史**：`setLayout` 本身不触发 `data_change`（`Command.js:127` 与 `Render.js:745` 只在 addHistory / undo/redo 触发），`.xmind` 字节因此保持纯净。导入的 xmind 一律按默认"向右分支结构"打开，忽略其自带 `structureClass`。

## Considered Options

- **写 xmind `structureClass`**：要同时改解析端、写回端、zip-preserve 三处；"向上"与"X"在 XMind 中无对应结构类，外部打开仍不一致；且与"保存不破坏往返"的既有边界冲突。
- **`mindMap`（左右双向）布局顶替 X**：内置 `mindMap` 在 4 个子节点时排成"右上/右下 + 左上/左下"，但节点是水平外扩、不是对角射线，且 2 个子节点时排成正左/正右——与要求的 X 语义不符。
- **把自研布局塞进主进程**：布局是纯渲染层概念，主进程只负责 xmind 字节读写；参观 renderer `binary-host/` 现有组件划分。

## Consequences

- 换机器、导出到其他机器打开：布局选择随 sidecar（Git 同步）到达，不依赖 xmind 字节本身；不使用 NexNote 的用户打开同一 .xmind 会看到"向右逻辑结构"。
- xmind 往返不变——保存仍经 `writeModelToXmind` + `preserveXmindReadonly`，`structureClass` 硬编码行为不动。
- 自研布局下的**节点拖拽在 v1 不可用**：Drag 插件内 `switch (opt.layout)` 有 6 处分发点，只有 `checkOverlapNode` 有可用 default，其余 5 处是空 default——占位符不会定位，drop 落点会静默错误。更劣的选项（映射 opt.layout 到库内名字）只能修一处而把其他错位，已否决。DEV-099 R5 启用的拖拽能力对"向上/X"两种结构暂退回"不响应"。
- `layoutValueList` 拦截补丁是第三方库升级的主要兼容风险点；升级 simple-mind-map 时须重新验证。

## 修订记录

- 2026-10-07：grill 第二轮曾建议"把自研布局的 `opt.layout` 映射到库内已支持的布局名，让 Drag 插件的分发命中 case"。该建议基于"Drag 的 `switch` 没有 default 分支"这一**错误前提**——复核发现 `checkOverlapNode` 有可用 default（`Drag.js:461-462`），但另有 5 处分发点（`handleOverlapNode` 两处、`getNewChildNodeDir`、`handleVerticalCheck` 两处）是空 `default`。映射方案只能救一处、且会让 Drag 用错误的坐标模型为自研布局计算占位符（drop 落点静默错误），故改为 v1 在自研布局下禁用拖拽。结论记入 Consequences。
