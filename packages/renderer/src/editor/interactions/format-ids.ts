/** Shared semantic ids for selection-formatting actions. */
export const FORMAT_BOLD = 'format:bold';
export const FORMAT_ITALIC = 'format:italic';
export const FORMAT_STRIKE = 'format:strike';
export const FORMAT_CODE = 'format:code';
export const FORMAT_LINK = 'format:link';
/** 双链（[[页面名]]），与外部 URL 链接独立。 */
export const FORMAT_WIKILINK = 'format:wikilink';
/** 字体颜色（颜色值由颜色选择器附加，见 applyTextColor）。 */
export const FORMAT_TEXT_COLOR = 'format:text-color';
/** 背景色（颜色值由颜色选择器附加，见 applyTextColor）。 */
export const FORMAT_BACKGROUND_COLOR = 'format:background-color';

export const SELECTION_FORMAT_ACTION_IDS = [
  FORMAT_BOLD,
  FORMAT_ITALIC,
  FORMAT_STRIKE,
  FORMAT_CODE,
  FORMAT_LINK,
  FORMAT_WIKILINK,
] as const;
