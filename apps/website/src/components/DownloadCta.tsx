import { links, productVersion, type Copy } from '../content';
import { Link } from '../router';

export function DownloadCta({ text }: { text: Copy }) {
  return (
    <section className="section download-cta">
      <div><p className="eyebrow">NEXNOTE · {productVersion}</p><h2>{text.ctaHeading}</h2><p>{text.fitNote}</p></div>
      <div className="cta-actions"><Link className="button primary" href={links.releases}>{text.download} ↗</Link><Link className="button secondary" href={links.github}>{text.github}</Link></div>
    </section>
  );
}
