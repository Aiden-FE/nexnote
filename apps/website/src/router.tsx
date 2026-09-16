import { useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { isThemeId, pathFor, type Lang, type ThemeId } from './content';

export interface Route { lang: Lang; theme?: ThemeId }
function parse(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const lang: Lang = parts[0] === 'zh' ? 'zh' : 'en';
  const candidate = lang === 'zh' ? parts[2] : parts[1];
  return isThemeId(candidate) ? { lang, theme: candidate } : { lang };
}
let snapshot: Route = parse(window.location.pathname);
const listeners = new Set<() => void>();
function emit() { snapshot = parse(window.location.pathname); listeners.forEach((listener) => listener()); }
window.addEventListener('popstate', emit);
export function navigate(href: string) { window.history.pushState({}, '', href); emit(); window.scrollTo({ top: 0, behavior: 'instant' }); }
export function useRoute() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot, () => snapshot); }
export function Link({ href, children, className = '', ...props }: { href: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className'>) {
  const internal = href.startsWith('/') && !href.startsWith('//');
  function onClick(event: MouseEvent<HTMLAnchorElement>) { props.onClick?.(event); if (event.defaultPrevented || !internal || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); navigate(href); }
  return <a {...props} href={href} className={className} onClick={onClick}>{children}</a>;
}
export { pathFor };
