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

const STORAGE_KEY = 'nexnote.translation.targetLanguage';

export function isKnownLanguage(value: string): boolean {
  return TRANSLATION_LANGUAGES.some((language) => language.id === value);
}

/** 含显著 CJK 的原文默认译为英文，否则默认译为简体中文（仅作初始值，用户可改）。 */
export function guessTargetLanguage(text: string): string {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters > 0 && cjk / letters > 0.2 ? 'English' : '简体中文';
}

/** 读取上次选择的目标语言；无记忆或值非法时返回 null。 */
export function readLastTargetLanguage(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw && isKnownLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 记住本次选择；localStorage 不可用（沙箱/隐私模式）时静默跳过。 */
export function rememberTargetLanguage(language: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    // 记忆是便利功能，不可用不应阻塞翻译
  }
}

/** 首次翻译的初始目标语言：上次选择优先，否则按原文语言猜测。 */
export function resolveInitialTargetLanguage(text: string): string {
  return readLastTargetLanguage() ?? guessTargetLanguage(text);
}
