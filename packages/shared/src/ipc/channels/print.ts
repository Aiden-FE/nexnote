import type { Result } from '../result';

/**
 * 文档打印通道（块文档 / Markdown 文档）。
 *
 * 渲染层负责从当前编辑器/预览收集「渲染后的语义 HTML」与当前应用样式，
 * 主进程用隐藏打印窗口调起系统打印对话框；真实打印由用户在系统对话框中确认。
 */
export const PRINT_CHANNELS = ['print:document'] as const;

export type PrintChannel = (typeof PRINT_CHANNELS)[number];

export interface PrintDocumentRequest {
  /** 打印窗口文档标题（用于窗口标题/系统任务列表，不直接作为页面页眉）。 */
  title: string;
  /** 完整 HTML 文档（含 `<style>`），由渲染层基于当前应用样式生成。 */
  html: string;
}

export interface PrintDocumentResult {
  /** 系统打印流程是否被确认提交；用户取消对话框时为 false。 */
  accepted: boolean;
  /** Electron 打印失败原因（accepted=false 时可能存在）。 */
  failureReason?: string;
}

export interface PrintChannelMap {
  'print:document': {
    request: PrintDocumentRequest;
    response: Result<PrintDocumentResult>;
  };
}
