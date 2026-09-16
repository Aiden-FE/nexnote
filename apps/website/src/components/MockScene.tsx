import type { Copy } from '../content';

export type SceneKind = 'editor' | 'graph' | 'chat';

export function MockScene({ kind, text }: { kind: SceneKind; text: Copy }) {
  return (
    <div className={`mock-scene mock-${kind}`}>
      <div className="mock-topbar"><span className="mock-dots">● ● ●</span><span>NexNote / Demo Vault</span><span className="mock-shortcut">⌘K</span></div>
      <div className="mock-content">
        {kind === 'editor' && <>
          <aside className="mock-sidebar"><b>Pages</b><span>◈ Home</span><span>◈ Research</span><span>◈ Ideas</span><span>◈ Reading list</span></aside>
          <div className="mock-document"><small>PAGE · RESEARCH</small><h3>Patterns that compound</h3><p className="mock-line line-long" /><p className="mock-line" /><p className="mock-line line-medium" /><div className="mock-wikilink">[[Progressive Recall]]</div><p className="mock-line line-short" /></div>
          <aside className="mock-mentions"><b>Linked mentions</b><span>3 references</span><span>confidence 0.86</span></aside>
        </>}
        {kind === 'graph' && <div className="mock-graph"><svg viewBox="0 0 520 250" aria-label="Relation index placeholder"><g className="graph-edges"><path d="M90 124 195 70 302 144 420 75M195 70 302 144 440 190M90 124 160 205 302 144" /></g><g className="graph-nodes"><circle cx="90" cy="124" r="15"/><circle cx="195" cy="70" r="11"/><circle cx="302" cy="144" r="19"/><circle cx="420" cy="75" r="11"/><circle cx="440" cy="190" r="10"/><circle cx="160" cy="205" r="9"/></g><text x="250" y="238">Relation Index</text></svg></div>}
        {kind === 'chat' && <>
          <div className="mock-document"><small>CONTEXT INJECTION</small><h3>Ask your knowledge</h3><p className="mock-line line-long" /><p className="mock-line line-medium" /><div className="mock-wikilink">8 related pages</div></div>
          <aside className="mock-chat"><b>AI session</b><span>3 cited sources</span><p>Progressive recall found related pages in your vault.</p><div className="permission-chips"><i>Chat</i><i>Edit</i><i>Full</i></div><button>Accept edit proposal</button></aside>
        </>}
      </div>
      <div className="placeholder-label">{text.placeholder}</div>
    </div>
  );
}
