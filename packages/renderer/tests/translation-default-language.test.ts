import { describe, expect, it } from 'vitest';
import {
  guessTargetLanguage,
  mapInterfaceLanguageToTranslationTarget,
  resolveInitialTargetLanguage,
} from '../src/features/ai/translation/languages';

describe('DEV-068 · 翻译初始目标语言三档优先级', () => {
  it('第一档：AI 设置显式全局默认优先于界面语言与原文猜测', () => {
    expect(resolveInitialTargetLanguage('hello world', '日本語', 'en-US')).toBe('日本語');
    expect(resolveInitialTargetLanguage('你好世界', 'Deutsch', 'zh-CN')).toBe('Deutsch');
  });

  it('第二档：无全局默认时按界面语言映射（en-US → English，zh-CN → 简体中文）', () => {
    expect(resolveInitialTargetLanguage('你好世界', undefined, 'en-US')).toBe('English');
    expect(resolveInitialTargetLanguage('hello world', undefined, 'zh-CN')).toBe('简体中文');
  });

  it('第二档：其他界面语言映射（ja/ko/fr/de/es/ru）', () => {
    expect(mapInterfaceLanguageToTranslationTarget('ja-JP')).toBe('日本語');
    expect(mapInterfaceLanguageToTranslationTarget('ko-KR')).toBe('한국어');
    expect(mapInterfaceLanguageToTranslationTarget('fr-FR')).toBe('Français');
    expect(mapInterfaceLanguageToTranslationTarget('de-DE')).toBe('Deutsch');
    expect(mapInterfaceLanguageToTranslationTarget('es-ES')).toBe('Español');
    expect(mapInterfaceLanguageToTranslationTarget('ru-RU')).toBe('Русский');
  });

  it('未知界面语言 tag 返回 undefined，走第三档原文猜测', () => {
    expect(mapInterfaceLanguageToTranslationTarget('xx-YY')).toBeUndefined();
    expect(resolveInitialTargetLanguage('hello world', undefined, 'xx-YY')).toBe(
      guessTargetLanguage('hello world'),
    );
  });

  it('三档兜底：无全局默认且无界面语言时按原文猜（与旧行为一致）', () => {
    expect(resolveInitialTargetLanguage('hello world', undefined, undefined)).toBe(
      guessTargetLanguage('hello world'),
    );
  });

  it('非法全局默认被忽略，回落界面语言映射', () => {
    expect(resolveInitialTargetLanguage('hello', 'Klingon', 'en-US')).toBe('English');
  });
});
