# DEV-098：撤销仓库内 docx 编辑，导入改为转块文档

状态：in progress
日期：2026-09-28

## 背景

DEV-074/DEV-084 引入了仓库内 docx 语义级往返编辑（WebContentsView 宿主 + TipTap）。
实际验收结论：该形态维护面大、体验与预期不符。决策：撤销仓库内 docx 直接编辑能力，
docx 只作为外部交换格式。

## 决策（与需求方逐条确认）

1. **移除「新建 DOCX」**：侧栏新建菜单、窗口文件菜单、命令面板全部去掉。
2. **导入语义变更**：「导入 DOCX」保留，但导入即转换为 `.md` 块文档入库
   （复用 `projectDocxToMarkdown` 投影），vault 内不再落 .docx 字节。
   sidecar 记 `{format:'native-block', sourceDocx}` 以便溯源。
3. **文件名**：`论文.docx` → `论文.md`（同名去重，复用现有重名策略）。
4. **转换提示**：导入完成后一次性提示未保留内容（页眉页脚/编号样式/上下标等）。
5. **点击 vault 内残留 .docx**：不打开，提示改用「导入 Word 文档」重新转换。
6. **保留 `docx:export`**（md → docx 下载导出），它是纯导出能力，不属于仓库内编辑。
7. **xlsx / xmind 不受影响**，维持刚验收通过的 WebContentsView 编辑器。
8. 删除为仓库内编辑服务的死代码：`binary:docx:read/save`、`docx:readPreview/createEditCopy/
   openEdit/save` channel、`DocxView.tsx`、`docx-editor.tsx`、`docx-semantic.ts`
   （readDocxToHtml/blocksToDocx）、shared `htmlToBlocks`/DocxBlock。
9. my-wiki 中调试产生的测试 .docx（未命名*.docx）连同 sidecar 一并清理。

## 验收

- 新建菜单（侧栏 + 窗口菜单 + 命令面板）无「新建 DOCX」。
- 导入外部 .docx → vault 内生成同名 .md 块文档，可正常块编辑；原件不入库。
- 点击 vault 内已有 .docx → 提示不支持，不崩溃。
- md 导出 docx（docx:export）不回归。
- xlsx/xmind 编辑器不回归。
