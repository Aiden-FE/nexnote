/** Shared semantic ids for selection-formatting actions. */
export const FORMAT_BOLD = 'format:bold';
export const FORMAT_ITALIC = 'format:italic';
export const FORMAT_STRIKE = 'format:strike';
export const FORMAT_CODE = 'format:code';
export const FORMAT_LINK = 'format:link';
/** 双链（[[页面名]]），与外部 URL 链接独立。 */
export const FORMAT_WIKILINK = 'format:wikilink';

export const SELECTION_FORMAT_ACTION_IDS = [
  FORMAT_BOLD,
  FORMAT_ITALIC,
  FORMAT_STRIKE,
  FORMAT_CODE,
  FORMAT_LINK,
  FORMAT_WIKILINK,
] as const;
