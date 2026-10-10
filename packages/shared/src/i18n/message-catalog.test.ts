import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

  it('renderer 经 t()/tr() 引用的 key 都存在于两份词典', () => {
    // 缺 key 时 translate() 回退为 key 本身（界面上直接显示 key 文本），
    // 而 tsc 不会报错（MessageCatalog 是宽松 index signature）。
    // 这里做可执行残留检查，防止迁移过程中漏建词典条目。
    const rendererRoot = resolve(import.meta.dirname, '../../../../packages/renderer/src');
    const known = new Set(Object.keys(MESSAGES_ZH_CN));
    const referenced = new Map<string, Set<string>>();

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const source = readFileSync(full, 'utf8');
        for (const match of source.matchAll(
          /(?:^|[^\w.])(?:t|tr|translate)\(\s*'([A-Za-z][\w.]*)'/g,
        )) {
          const key = match[1] ?? '';
          if (!key.includes('.')) continue; // 排除事件名等误匹配
          const file = full.slice(rendererRoot.length + 1);
          referenced.set(key, (referenced.get(key) ?? new Set()).add(file));
        }
      }
    };
    walk(rendererRoot);

    const missing = [...referenced.entries()]
      .filter(([key]) => !known.has(key))
      .map(([key, files]) => `${key}（${[...files].join(', ')}）`)
      .sort();
    expect(missing, `缺少消息目录条目：\n${missing.join('\n')}`).toEqual([]);
  });
});
