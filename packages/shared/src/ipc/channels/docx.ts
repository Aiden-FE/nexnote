import type { Result } from '../result';

/**
 * DOCX 命名空间（DEV-098 撤销仓库内编辑后收窄）：
 * docx 仅作为外部交换格式——
 * - `docx:import`：导入即转换为 `.md` 块文档入库（Markdown 投影），vault 内不落 .docx 字节；
 * - `docx:export`：把块文档导出为新 .docx（vault 外交付用）。
 * 仓库内 docx 编辑（readPreview/createEditCopy/openEdit/save、binary:docx:*）已删除。
 */

export const DOCX_CHANNELS = ['docx:import', 'docx:export'] as const;

export type DocxChannel = (typeof DOCX_CHANNELS)[number];

export interface DocxChannelMap {
  /**
   * 导入 vault 外 .docx 并转换为块文档：不携带 data 时经主进程 dialogs.pickFile
   * 选择文件（外部路径不接受 renderer 提供，防任意本地读取）；data 为 renderer
   * 显式提供的 base64（拖拽路径）。转换经 projectDocxToMarkdown 投影，产物为
   * `<stem>.md`（同名去重），sidecar 记 {format:'native-block', sourceDocx, sourceSha256}。
   * Word 专属排版（页眉页脚、编号样式、上下标等）不保留。返回 null 表示用户取消选择。
   */
  'docx:import': {
    request: {
      data?: string;
      name?: string;
      targetDir?: string;
    };
    response: Result<{ path: string } | null>;
  };
  /**
   * 导出 .md 为新 .docx：默认写同目录 `<stem>.docx`（重名自动去抖），
   * targetPath 显式指定时已存在即拒绝；绝不覆盖已有文件。
   */
  'docx:export': {
    request: { path: string; targetPath?: string };
    response: Result<{ path: string }>;
  };
}
