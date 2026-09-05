import { useEffect, type ReactNode } from 'react';
import { useThemeStore } from './theme-store';

/**
 * 主题 Provider：把 resolved 主题落到 <html class="dark"> + colorScheme，
 * system 偏好下监听系统切换。CSS 令牌见 globals.css（shadcn + editor 桥接变量）。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolved = useThemeStore((s) => s.resolved);
  const preference = useThemeStore((s) => s.preference);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    if (preference !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => useThemeStore.getState().__resolveSystem();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  return <>{children}</>;
}
