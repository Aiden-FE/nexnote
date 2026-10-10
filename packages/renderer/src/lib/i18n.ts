/**
 * 渲染层 i18n 入口（ADR-0023 阶段①）。
 *
 * - 语言权威来自设置 store 的 `appearance.language`；本模块只负责让消息目录随语言生效。
 * - 当前语言状态保存在 shared 的 `message-catalog`，kernel 菜单等非 React 代码也能读取。
 * - `t()` 可命令式调用（非组件代码、回调、事件处理器）。
 * - `useI18n()` 订阅语言变化，切到 English 后所有用它的组件重渲染。
 * - 界面语言不改变页面正文、提交历史与 AI 提示词。
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  CATALOGS,
  getCurrentLanguage,
  setCurrentLanguage,
  subscribeCurrentLanguage,
  translate,
  type UiLanguage,
} from '@nexnote/shared';

/** 兼容既有 renderer 调用点：代理 shared 的当前语言订阅。 */
export const subscribeLanguage = subscribeCurrentLanguage;

/** 兼容既有 renderer 调用点：读取 shared 中的当前语言。 */
export const getLanguage = getCurrentLanguage;

/** 设置当前界面语言；非法值回退默认。仅更新内存中的语言与订阅者。 */
export const setLanguage = setCurrentLanguage;

/** 命令式取当前语言文案。 */
export function t(
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const language = getCurrentLanguage();
  return translate(CATALOGS[language], key, language, params);
}

/**
 * 组件内取文案；订阅语言，切语言时重渲染。
 *
 * 返回值随语言变化（`useCallback` 依赖 `language`），以便把 `t` 放进
 * `useMemo` / `useEffect` 依赖时能在切语言后正确重算。
 */
export function useI18n(): (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage);
  return useCallback(
    (key: string, params?: Readonly<Record<string, string | number>>) =>
      translate(CATALOGS[language], key, language, params),
    [language],
  );
}

export function useLanguage(): UiLanguage {
  return useSyncExternalStore(subscribeLanguage, getLanguage);
}
