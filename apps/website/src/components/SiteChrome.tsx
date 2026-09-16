import { alternatePath, links, pathFor, productVersion, type Copy, type Lang, type ThemeId } from '../content';
import { Link } from '../router';
import { BrandLink, Mark } from './Brand';

interface HeaderProps { lang: Lang; text: Copy; theme?: ThemeId }
export function SiteHeader({ lang, text, theme }: HeaderProps) {
  const navItems = theme
    ? [
        { label: text.navGallery, href: pathFor(lang) },
        { label: text.navFeatures, href: '#features' },
        { label: text.navScenes, href: '#scenes' },
        { label: text.navFaq, href: '#faq' },
      ]
    : [
        { label: text.navGallery, href: '#gallery' },
        ...(['editorial', 'workbench', 'graph', 'quiet'] as const).map((id) => ({ label: id, href: pathFor(lang, id) })),
      ];
  return (
    <header className="site-header">
      <BrandLink href={pathFor(lang)} />
      <nav aria-label="Primary navigation">
        {navItems.map((item) => <Link key={item.label} href={item.href}>{item.label}</Link>)}
      </nav>
      <div className="header-actions">
        <Link className="language-switch" href={alternatePath(lang, theme)}>{text.switchLabel}</Link>
        <Link className="header-github" href={links.github}>GitHub</Link>
      </div>
    </header>
  );
}

export function SiteFooter({ lang, text }: { lang: Lang; text: Copy }) {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <BrandLink className="footer-brand" href={pathFor(lang)} />
        <p>{text.footerTagline}</p>
      </div>
      <div className="footer-meta"><span>{text.footerRights} · {productVersion}</span><span>{text.footerNote}</span><Link href={pathFor(lang)}>{text.navGallery}</Link></div>
      <div className="footer-mark"><Mark /></div>
    </footer>
  );
}
