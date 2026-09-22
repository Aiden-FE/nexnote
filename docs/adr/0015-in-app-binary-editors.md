---
status: accepted
---

# 应用内二进制编辑器：仓库内副本 + R3 OSS 组合 + WebContentsView 宿主

NexNote 需要在产品内直接打开并编辑 docx / xlsx / xmind 三种二进制文件，达到类似 WPS / 语雀 / Notion 的编辑预览效果。本 ADR 取代 docx「阶段6」的「原件只读」硬约束，并确定选型、宿主、保真边界与入库策略。

**2026-09-22 修订**：选型 spike 证实 xlsx/docx 的导入导出不在 OSS `@univerjs/*` 而在专有许可的 `@univerjs-pro/*`（含 license server 依赖），与本地优先定位冲突；选型改记 R3 OSS 组合（Decision 2），并把 docx 保真承诺从字节级降级为语义级（Decision 4）。

## Decision

1. **仓库内副本（Vault Copy）语义统一**：docx / xlsx / xmind 导入后在知识库内各生成一份合规副本，导入时内容与外部原件一致，此后与原件脱钩；副本可被应用内编辑器原地覆写，随 Git 版本化，可直接交给外部软件使用。撤销 `DocxService` 的「原 .docx 永不写回」硬约束及相关测试断言。
2. **编辑器选型（R3 OSS 组合，2026-09-22 修订）**：
   - **xlsx**：`fortune-sheet`（MIT，1.0.x）承担单元格编辑，`@corbe30/fortune-excel`（MIT，2.3.x）承担 .xlsx 导入导出；spike 已验证多 sheet、公式、合并单元格、列宽保留。
   - **docx**：`mammoth`（BSD-2-Clause）读取为 HTML，TipTap 编辑，`docx`（dolanmiu/docx，MIT）重建 .docx；spike 已验证段落、标题、加粗/斜体、表格、字体色、居中保留，上下标、页眉页脚、列表编号样式不保留。
   - **思维导图**：`simple-mind-map`（MIT，0.14.x）承担编辑与 .xmind 导入导出；spike 已验证文本、树结构、备注、超链接、标签、概要保留；外框与关联线在 xmind 解析端不实现。
   - 现有自研 `packages/main/src/docx/`（Markdown 投影 + docx-edit）保留为导入 fail-closed 校验与降级路径，不再作为 docx 的主编辑形态。
3. **宿主**：编辑器运行在独立 `WebContentsView` 进程（Q10-C），与块编辑主窗口崩溃隔离；保存、主题、命令经 IPC 桥接。
4. **保真边界（Q17-A，2026-09-22 修订）**：xlsx 承诺单元格数据 + 公式 + 基础样式的往返；docx 为**语义级往返而非字节级保真**（段落与标题结构、加粗/斜体、表格内容、字体色、对齐保留；页眉页脚、编号样式、上下标等不保留）；xlsx 宏 / 图表 / 透视表、xmind 高级主题样式 / 外框 / 关联线归入只读保留区，编辑器内只读标注，保存时原字节不丢失；不支持内容绝不悄悄丢弃。
5. **fail-closed 导入校验**：zip/XML schema 校验失败即拒绝导入并给出明确错误；与现有 docx 导入校验同一策略。
6. **保存时机（Q14-C）**：编辑即写（debounce）落盘 vault 副本，关闭 tab / 窗口时等待 pending 写入完成；不引入文件级版本快照，版本化由现有 Git 自动提交与版本时间线承担。
7. **Git 策略（Q7-C）**：二进制文档默认随 vault 跟踪，设置项可切换为不跟踪（写入 `.gitignore`），不改动 ADR 0003 的同步护栏语义。
8. **v1 边界（Q8-A）**：二进制文档不进双链 / 回链 / 关系索引 / AI 召回；页面树默认视图扩展显示 `.docx/.xlsx/.xmind`，文件名可搜索。
9. **Tab 模型（Q12-A）**：`TabKind` 追加 `'xlsx' | 'mindmap'`，与 `'docx'` 并列，不抽象统一 `'binary'`。
10. **入口（Q9）**：页面树右键导入、拖拽到页面树 / 编辑器、命令面板；不做系统级文件关联。
11. **交付形态（Q18-B）**：单里程碑全量交付，范围即上述 1–10。
12. **内存基线与 Tab 并发上限（2026-09-22 spike 4）**：Electron 33.2.0 / arm64 / WebContentsView 实测冷启动 load→READY 与 rss：xlsx（fortune-sheet，1000×10 单元格）96ms / 161.5MB；mindmap（simple-mind-map，200 节点）77ms / 185.3MB；docx（TipTap，50 节）82ms / 109.4MB（叠加 mammoth 读取与 dolanmiu/docx 重建，生产估算约 250MB）。二进制文档 tab 并发上限 ≤3，超出时复用已有 tab 或提示关闭；xlsx bundle gzip 597KB，需按需加载。

## Considered Options

- **Univer Pro（`@univerjs-pro/*`）**：xlsx/docx 导入导出的官方实现，但为 Proprietary 许可且依赖 license server，与本地优先 / 无服务端定位冲突；2026-09-22 spike 后否决。
- **docx 保留自研**：风险最低，但 UX 上限是段落级编辑，达不到产品诉求；否决。
- **Univer 换 x-spreadsheet**：x-spreadsheet 已迁移至 `@wolf-table/table` 且原库停更，否决。
- **编辑器内嵌 / iframe 宿主（Q10-A/B）**：交互顺滑但崩溃与样式污染会波及主窗口；二进制编辑器属外来大块头，按 Q10 推荐选 WebContentsView 隔离。
- **文件级版本快照副本（Q13-B）**：与 Git 版本时间线职责重复，污染文件树，否决。

## Consequences

- `packages/main/tests/docx-*` 与 `packages/shared/src/ipc/channels/docx.ts` 中「原件只读 / 导出绝不覆盖」的用例与注释需改写为仓库内副本语义。
- 安装包与内存体积增加：fortune-sheet + fortune-excel + mammoth + dolanmiu/docx + simple-mind-map 打包进 Electron 资源；WebContentsView 每文档一个独立进程，需设定 tab 并发上限。
- 许可合规：MIT（fortune-sheet / fortune-excel / dolanmiu/docx / simple-mind-map）与 BSD-2-Clause（mammoth）均为宽松许可，随附许可文本需追加至 `licenses/` 目录，与 MIT 主仓兼容。
- docx 语义级往返意味着 vault 内 docx 经一次编辑保存后高级排版不可逆丢失，需在 user guide 显式告知；含复杂排版的文档建议用户保留 vault 外原件。
- Spike 证据（2026-09-22，headless node 验证）：docx/xlsx/xmind 导入与往返矩阵通过；遗留验收项为 WebContentsView 下三者的冷启动、滚动 fps 与内存峰值基线。
