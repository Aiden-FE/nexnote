/**
 * 临时翻译（DEV-041）目标语言选项与「上次选择」记忆。
 *
 * 语言随每次翻译可选，选择结果只作为界面偏好记忆（localStorage），
 * 不进入 vault 配置、不写盘、不参与文档内容。
 */

export interface TranslationLanguageOption {
  /** 送进 prompt 的目标语言名（须匹配主进程目标语言校验字符集）。 */
  id: string;
  label: string;
}

export const TRANSLATION_LANGUAGES: TranslationLanguageOption[] = [
  { id: '简体中文', label: '简体中文' },
  { id: '繁體中文', label: '繁體中文' },
  { id: 'English', label: 'English' },
  { id: '日本語', label: '日本語' },
  { id: '한국어', label: '한국어' },
  { id: 'Français', label: 'Français' },
  { id: 'Deutsch', label: 'Deutsch' },
  { id: 'Español', label: 'Español' },
  { id: 'Русский', label: 'Русский' },
];

export function isKnownLanguage(value: string): boolean {
  return TRANSLATION_LANGUAGES.some((language) => language.id === value);
}

/** 含显著 CJK 的原文默认译为英文，否则默认译为简体中文（旧配置缺省时的兼容兜底）。 */
export function guessTargetLanguage(text: string): string {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters > 0 && cjk / letters > 0.2 ? 'English' : '简体中文';
}

/**
 * 界面语言 tag → 翻译目标语言（DEV-068）。
 * 仅映射 TRANSLATION_LANGUAGES 内存在的语言；未知 tag 返回 undefined 走兜底。
 */
export function mapInterfaceLanguageToTranslationTarget(
  tag: string | undefined,
): string | undefined {
  if (!tag) return undefined;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return '简体中文';
  if (lower.startsWith('en')) return 'English';
  if (lower.startsWith('ja')) return '日本語';
  if (lower.startsWith('ko')) return '한국어';
  if (lower.startsWith('fr')) return 'Français';
  if (lower.startsWith('de')) return 'Deutsch';
  if (lower.startsWith('es')) return 'Español';
  if (lower.startsWith('ru')) return 'Русский';
  return undefined;
}

/**
 * 初始目标语言三档优先级（DEV-068）：
 * 1. AI 设置显式全局默认（translationTargetLanguage）
 * 2. 界面显示语言映射（设置常规 appearance.language）
 * 3. 按原文语种猜测（旧兼容兜底）
 */
export function resolveInitialTargetLanguage(
  text: string,
  globalDefault?: string,
  interfaceLanguage?: string,
): string {
  if (globalDefault && isKnownLanguage(globalDefault)) return globalDefault;
  const fromInterface = mapInterfaceLanguageToTranslationTarget(interfaceLanguage);
  if (fromInterface) return fromInterface;
  return guessTargetLanguage(text);
}
