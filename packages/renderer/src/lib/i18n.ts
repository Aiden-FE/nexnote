/**
 * 渲染层 i18n 入口（ADR-0023 阶段①）。
 *
 * - 语言权威来自设置 store 的 `appearance.language`；本模块只负责让消息目录随语言生效。
 * - `t()` 可命令式调用（非组件代码、回调、事件处理器）。
 * - `useI18n()` 订阅语言变化，切到 English 后所有用它的组件重渲染。
 * - 界面语言不改变页面正文、提交历史与 AI 提示词。
 */
import { useSyncExternalStore } from 'react';
import {
  CATALOGS,
  DEFAULT_UI_LANGUAGE,
  isUiLanguage,
  translate,
  type UiLanguage,
} from '@nexnote/shared';

let currentLanguage: UiLanguage = DEFAULT_UI_LANGUAGE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 订阅界面语言；返回 unsubscribe。 */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLanguage(): UiLanguage {
  return currentLanguage;
}

/** 设置当前界面语言；非法值回退默认。仅更新内存中的语言与订阅者。 */
export function setLanguage(language: unknown): UiLanguage {
  const next = isUiLanguage(language) ? language : DEFAULT_UI_LANGUAGE;
  if (next === currentLanguage) return next;
  currentLanguage = next;
  emit();
  return next;
}

/** 命令式取当前语言文案。 */
export function t(
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  return translate(CATALOGS[currentLanguage], key, currentLanguage, params);
}

/** 组件内取文案；订阅语言，切语言时重渲染。 */
export function useI18n(): (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string {
  useSyncExternalStore(subscribeLanguage, getLanguage);
  return t;
}

export function useLanguage(): UiLanguage {
  return useSyncExternalStore(subscribeLanguage, getLanguage);
}
