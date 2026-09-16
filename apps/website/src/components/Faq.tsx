import type { Copy } from '../content';
export function Faq({ text }: { text: Copy }) { return <section id="faq" className="section faq"><p className="eyebrow">FAQ</p><h2>{text.faqHeading}</h2><div className="faq-grid">{text.faqs.map((item) => <details key={item.title}><summary>{item.title}<span>+</span></summary><p>{item.body}</p></details>)}</div></section>; }
