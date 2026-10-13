# ADR-0026 xmind 结构类以文件为权威

## 背景

ADR-0020 曾把 NexNote 的 mindmap 结构选择保存在 sidecar（`mindmapStructure`），并明确 v1
不承诺“外部 XMind 打开时结构一致”。后续产品诉求升级：`.xmind` 交给其他 XMind 软件时，
结构应高度一致。sidecar 对外部软件不可见，而 `simple-mind-map` 写回端硬编码
`org.xmind.ui.logic.right`，因此外部结构一致性从未成立。

## Decision

1. **文件权威**：受支持结构的唯一权威写入 `.xmind` 根节点的官方
   `structureClass`（`org.xmind.ui.logic.right` / `org.xmind.ui.logic.left` /
   `org.xmind.ui.org-chart.down` / `org.xmind.ui.fishbone.rightHeaded`）。导入时读取
   root structureClass 并映射到 NexNote 布局；子节点的 structureClass 不参与结构选择。
2. **sidecar 降级为 legacy 迁移来源**：旧 `mindmapStructure` 只在首次模型保存时迁移为
   root structureClass；读取时不再作为结构权威。legacy `up` / `x` 布局保留渲染能力，
   但结构面板不再提供这两个选项。
3. **未知官方结构保留**：导入到未映射的官方 structureClass 时，NexNote 按向右布局打开，
   显示只读保留标注，保存时不改写 root structureClass。用户显式切换到受支持结构后才覆写。
4. **结构标识与画布渲染一致**：NexNote 画布使用与官方结构对应的 simple-mind-map 布局
   （`logicalStructure` / `logicalStructureLeft` / `organizationStructure` / `fishbone`）。
   不承诺像素级一致；只承诺外部软件识别的结构模式一致。
5. **写回所有权**：`preserveXmindReadonly` 中 root 的 `structureClass` 只有在重建端
   明确写入时才被重建值拥有；重建端未输出时保留原文件结构。子节点 structureClass
   仍由旧版保留逻辑原样回填。

## Considered Options

- sidecar 继续作为用户选择来源，仅保存时同步到字节：外部软件修改结构后，NexNote 下一次
  保存会回写旧结构，导致“所见即所改”失败，故否决。
- 保留 up/x 并伪造官方结构：官方枚举中没有对应结构，伪造会导致外部打开仍不一致，故隐藏。
- 导入未知结构时覆写为向右：会破坏外部文档结构，违反“只读保留区不悄悄丢失”边界，故保留。

## Consequences

- 外部 XMind 软件读取 NexNote 保存的 `.xmind` 时，四类受支持结构按官方 structureClass 选择。
- XMind 官方应用人工打开验证本机未安装，验收记录为 `NOT_RUN`；自动化契约以官方
  `xmindltd/xmind-model` 枚举为准。
- legacy sidecar `up/x` 文件仍可编辑渲染，但用户下一次显式选择受支持结构后，文件永久迁移。
