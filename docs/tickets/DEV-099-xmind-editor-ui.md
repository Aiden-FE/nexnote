# DEV-099 xmind 编辑器常规操作界面（工具栏 / 抽屉 / 主题 / 标记）

状态：done（2026-09-28，电脑控制实测验收）
日期：2026-09-28

## 背景

xmind 编辑器（simple-mind-map WebContentsView）此前只有裸画布，所有交互靠猜：
无缩放/适应画布/主题入口，无撤销/重做/保存入口，节点操作（加子节点/折叠/形状/
颜色/标记）无任何可见入口。用户要求对齐常规思维导图工具的编辑体验。

## 决策（grill 两轮确认）

1. **布局**：画布占满宿主；左上角悬浮组（撤销/重做/保存状态/立即保存）、右上角悬浮组
   （缩小/百分比/放大/适应画布/复位/主题下拉）；常驻半透明、hover 提亮，不自动隐藏。
2. **节点编辑**：选中节点自动拉开右侧抽屉（点空白自动收、头部手动收合按钮），
   悬浮覆盖不挤画布。抽屉三节：节点（加子/加兄弟/删除/展开折叠）、样式（形状 6 种、
   颜色 12 色板+无、标记 12 个）、附加（备注、超链接）。
3. **保存语义不变**：编辑即写（debounce）；「立即保存」= 立即 flush；状态文字显示
   编辑中…/已保存/失败。
4. **主题**：5 套 curated 预设（经典绿/商务蓝/暖橙/暗色/极简灰），经
   `setThemeConfig(deepMerge(base, preset))` 应用；选择持久化到 sidecar
   `mindmapTheme` 字段（新 IPC `binary:mindmapTheme:set`；读复用 `document:getMetadata`），
   不污染 xmind 字节。
5. **插件/交互**：注册 Drag 插件（节点拖拽）+ 核心画布平移；不做滚动条/小地图。
6. **快捷键**：Delete 删除选中、Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 与 Ctrl+Y 重做、
   Ctrl/Cmd+S 立即保存。
7. **标记图标**：lucide（shadcn 图标语言）优先——signal-high/medium/low、circle、
   contrast、circle-check、circle-x、star、flag、heart、triangle-alert 共 12 个，
   以 24×24 stroke SVG 字符串写入 model 的 icon 数据；UI 按钮用 lucide-react 组件。
8. **形状**：rectangle / roundedRectangle / ellipse / circle / diamond / parallelogram。

## 验收

- 四角悬浮组与抽屉在电脑控制下逐项点验：缩放百分比变化、适应画布、撤销重做、
  立即保存状态、主题切换且重开文档后保持、加子/兄弟/删除/折叠、形状/颜色/标记生效、
  备注/超链接写入 model 并落盘。
- xlsx / docx(已撤销) / 块编辑不回归；测试全绿。
