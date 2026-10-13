# DEV-114 xmind 文件在其他 XMind 软件内结构高度一致

## 背景与需求

`.xmind` 保存到知识库后会交给其他 XMind 软件打开。此前 ADR-0020 将结构选择存放在
sidecar，且写回端硬编码 `org.xmind.ui.logic.right`，外部软件始终看到向右逻辑结构。

## 决策

- 受支持结构（向右 / 向左 / 向下 / 鱼骨）写入 XMind 官方 root `structureClass`。
- sidecar `mindmapStructure` 降级为 legacy 迁移来源；文件字节成为结构权威。
- 导入官方未知结构时按向右渲染并保留原 root structureClass，显示只读保留标注。
- 结构面板隐藏无官方对应的 `up` / `x`。
- 结构标识与 NexNote 画布布局一致：logic right/left、org-chart down、fishbone rightHeaded。

## 验收

- [x] 新建/编辑受支持结构后，content.json root 带官方 structureClass（主进程契约测试）
- [x] 官方未知结构保存后原样保留（主进程契约测试）
- [x] legacy sidecar right/left/down/fishbone 首次保存迁移为字节权威（主进程契约测试）
- [x] legacy sidecar up/x 不被迁移为受支持结构（主进程契约测试）
- [x] 结构面板不出现 up/x，且现有受支持结构仍可切换（渲染端组件测试）
- [x] 受支持结构导入读取映射、未知结构标注（主进程契约测试）
- [ ] XMind 官方应用人工打开验证 —— **NOT_RUN（本机未安装 XMind）**
