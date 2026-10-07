# DEV-102 mindmap 布局结构（六种 + 根节点 X 结构）

状态：proposed（grill 三轮确认，ADR-0020 已记录存储决策）
日期：2026-10-07
关联：ADR-0020、DEV-074、DEV-099、DEV-100

## 背景

用户要求 xmind 编辑器支持节点布局结构编辑（参照语雀画板的"结构"面板）：向右分支结构（默认）、向左、向上、向下三种分支结构、四向的鱼骨结构，以及首节点（根节点）额外支持的 X 结构——仅当子节点数 ≥ 2 时可用，启用后一级子节点按左上、右上、左下、右下分布。

grill 后的事实底座：

- simple-mind-map 0.14.0 内置可用：`logicalStructure`（向右）、`logicalStructureLeft`（向左）、`organizationStructure`（向下）、`fishbone` / `fishbone2`（鱼骨）；`mindMap`（左右双向）虽可用但与 X 语义不符。
- **"向上"必须自研**（库内不存在任何向上生长的树布局）；`rightFishbone` / `rightFishbone2` 是死枚举（`Render.js` 的 layouts 表无 entry，会被静默降级为向右），所以"左向鱼骨"不存在。
- xmind 字节的 `structureClass` 在 NexNote 解析端丢弃、写回端硬编码——结构选择无法进入 .xmind 字节。

## 决策（grill 三轮确认）

1. **六个布局结构选项**（UI 名称暂定，可按后续验收微调）：
   - 向右分支结构（默认，映射 `logicalStructure`）
   - 向左分支结构（映射 `logicalStructureLeft`）
   - 向上分支结构（自研：组织结构图镜像——根在底，一级分支横排、逐级向上）
   - 向下分支结构（映射 `organizationStructure`）
   - 鱼骨结构（映射 `fishbone`，主轴向右、分支上下交替）
   - X 结构（自研：仅根节点子节点 ≥ 2 时可选；一级子节点分配到左上/右上/左下/右下象限；恰为 2 个时退化为左右形式）
2. **存储**：sidecar `DocumentMetadata.mindmapStructure` 字段，与 `mindmapTheme` 同构——读走既有 `document:getMetadata`，写走新增 IPC `binary:mindmapStructure:set`。不写 xmind 字节（ADR-0020）。
3. **注册机制**：自研"向上"与"X"实现为 `packages/renderer/src/binary-host/mindmap-layouts/` 下的布局类，遵循第三方库 `Base` 契约（`doLayout` / `renderLine` / `renderExpandBtn`），通过把类挂到实例 + 拦截 `layoutValueList` 白名单注入；不改 `node_modules`。库升级时的兼容性验证是升级检查清单项。
4. **切换不写 data、不进撤销历史**：`setLayout` 本身不写节点数据、不触发 `data_change`，.xmind 字节被切结构这一动作保持纯净。导入的 xmind 一律按默认向右打开，忽略其自带 `structureClass`。
5. **X 结构降级（Q10-A）**：选中 X 后子节点掉回 < 2 的，画布保留最后一次有效分布（按该子节点上次被分配的象限方向渲染，不重排成别的形状），菜单里 X 置灰不可再选（回退需改回其他结构触发），sidecar 不被自动改写；恰为 2 个时按左右形式渲染。实现上以 `uid → 象限` 的模块级记忆实现（`lastAssignment`），根节点子节点数由 `data_change` 实时树刷新。
6. **自研布局下暂不支持节点拖拽**：Drag 插件按 `opt.layout` 的 switch 有 6 处分发点，其中 5 处空 default——未知布局名下拖拽占位符不定位、drop 落点静默错误。v1 在向上/X 两种结构下禁用拖拽（DEV-099 R5 的拖拽能力对这两种暂不生效），在 changeLayout 时按结构名门控。
7. **验证策略**（相对 grill 原案有修订，见下）：UI 层（结构菜单选项、禁用逻辑、切换回调）沿用 DEV-099 "不 mock simple-mind-map" 的约定。**几何正确性改用纯函数/布局类单测断言**（`mindmap-layout-subtree` 断言子树排布内核坐标、`mindmap-layout-geometry` 直接构造布局类断言象限与不重叠），原因：库内 `Base` 依赖 DOM 与渲染管线，整树渲染无法在单测里忠实还原，而"向上是否真的向上、X 是否真的在四象限"恰恰是本 ticket 的核心语义——用眼睛验收只能证明"看起来没坏"。电脑控制实操验收仍作为交付前的补充项保留。

## 验收

- 电脑控制点验六种结构的切换与渲染：向右/向左/向下/鱼骨四种库内映射即切即看；向上（自研镜像）与 X（自研象限分配）逐节点核对坐标不重叠、方向正确。
- X 结构置灰逻辑：子节点 0/1 个时置灰、≥ 2 时可选、恰为 2 时画布走左右形式；从 4 个子节点降到 1 个时画布保留最后分布。
- sidecar 往返：选择结构后关闭文档、重开，结构保持；跨设备（Git 同步 sidecar）到达后打开同文档结构一致。
- .xmind 字节在切结构前后 sha256 一致（保存流程不因切结构产生 diff）。
- 拖拽行为：向上/X 结构下禁用节点拖拽（拖不动为预期结果，无假占位符）；四种库内结构与 DEV-099 现状一致。**该项依赖电脑控制实操点验**（库内 Drag 插件为全局插件表，实例级卸载在单测里无法忠实模拟）。
- 测试全绿：renderer UI 测试（菜单项、禁用）、main 侧 IPC validator 注册、既有 xmind 往返零回归。
