import { describe, expect, it } from 'vitest';
import {
  CATALOGS,
  DEFAULT_UI_LANGUAGE,
  MESSAGES_EN_US,
  MESSAGES_ZH_CN,
  isUiLanguage,
  missingKeys,
  translate,
  uiLanguageFromSystem,
} from './message-catalog';

describe('message catalog（ADR-0023）', () => {
  it('默认语言是 zh-CN，非法语言值一律回退', () => {
    expect(DEFAULT_UI_LANGUAGE).toBe('zh-CN');
    expect(isUiLanguage('zh-CN')).toBe(true);
    expect(isUiLanguage('en-US')).toBe(true);
    expect(isUiLanguage('en')).toBe(false);
    expect(isUiLanguage('zh')).toBe(false);
    expect(isUiLanguage(null)).toBe(false);
  });

  it('首次启动按系统语言初始化：zh* → zh-CN，其余 → en-US', () => {
    expect(uiLanguageFromSystem(['zh-CN'])).toBe('zh-CN');
    expect(uiLanguageFromSystem(['zh-Hans-CN'])).toBe('zh-CN');
    expect(uiLanguageFromSystem(['en-US'])).toBe('en-US');
    expect(uiLanguageFromSystem(['fr-FR'])).toBe('en-US');
    expect(uiLanguageFromSystem([])).toBe('en-US');
    expect(uiLanguageFromSystem(undefined)).toBe('en-US');
  });

  it('两份词典 key 完全对齐（en-US 不缺 key）', () => {
    expect(missingKeys('en-US')).toEqual([]);
    expect(Object.keys(MESSAGES_ZH_CN).sort()).toEqual(Object.keys(MESSAGES_EN_US).sort());
  });

  it('按语言取文案，切换语言得到不同结果', () => {
    const zh = translate(CATALOGS['zh-CN'], 'settings.appearance.title', 'zh-CN');
    const en = translate(CATALOGS['en-US'], 'settings.appearance.title', 'en-US');
    expect(zh).toBe('外观');
    expect(en).toBe('Appearance');
    expect(zh).not.toBe(en);
  });

  it('key 缺失时回退 zh-CN，再回退 key 本身（缺失可见而非空白）', () => {
    const partial = { 'common.ok': 'OK' } as const;
    // 传不存在的词典时回退中文基线
    expect(translate({}, 'common.cancel', 'en-US')).toBe('取消');
    // 两边都缺 → 回退 key 本身
    expect(translate(partial, 'nope.missing', 'en-US')).toBe('nope.missing');
  });

  it('占位符按当前语言替换，缺参数时保留原样', () => {
    const catalog = {
      'x.greet': { zhCN: '你好，{name}', enUS: 'Hello, {name}' },
    } as const;
    expect(translate(catalog, 'x.greet', 'zh-CN', { name: '小明' })).toBe('你好，小明');
    expect(translate(catalog, 'x.greet', 'en-US', { name: 'A' })).toBe('Hello, A');
    expect(translate(catalog, 'x.greet', 'en-US')).toBe('Hello, {name}');
  });

  it('en-US 词典不含中文残留（ADR-0023 完成门槛的可执行检查）', () => {
    // 语言名称本身是双语标签，属刻意保留
    const allowed = new Set(['settings.appearance.language.zhCN']);
    const cjk = /[一-鿿]/;
    const offenders = Object.entries(MESSAGES_EN_US)
      .filter(([key, value]) => !allowed.has(key) && typeof value === 'string')
      .filter(([, value]) => cjk.test(value as string))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
