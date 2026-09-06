import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@nexnote/shared';
import {
  filterGraph,
  graphElements,
  layoutGraph,
  localGraph,
} from '../src/features/graph/model';

function page(path: string, overrides: Partial<GraphSnapshot['pages'][number]> = {}) {
  return {
    path,
    title: path,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    tags: [],
    inboundLinks: 0,
    outboundLinks: 0,
    ...overrides,
  };
}

const snapshot: GraphSnapshot = {
  pages: [
    page('a.md', { tags: ['work'] }),
    page('work/b.md', { tags: ['work/project'] }),
    page('docs/c.md', { tags: ['docs'] }),
    page('isolated.md'),
  ],
  links: [
    { source: 'a.md', target: 'work/b.md' },
    { source: 'work/b.md', target: 'docs/c.md' },
  ],
};

describe('graph model', () => {
  it('filters by tag and folder subtrees and optionally hides isolated pages', () => {
    expect(
      filterGraph(snapshot, { tag: 'work', folder: '', showIsolated: true }).pages.map((item) => item.path),
    ).toEqual(['a.md', 'work/b.md']);
    const folderGraph = filterGraph(snapshot, { tag: '', folder: 'work', showIsolated: false });
    expect(folderGraph.pages.map((item) => item.path)).toEqual(['work/b.md']);
    expect(folderGraph.links).toEqual([]);
    expect(
      filterGraph(snapshot, { tag: '', folder: '', showIsolated: false }).pages.map((item) => item.path),
    ).toEqual(['a.md', 'work/b.md', 'docs/c.md']);
  });

  it('builds deterministic one-hop and two-hop local graphs', () => {
    expect(localGraph(snapshot, 'work/b.md', 1).pages.map((item) => item.path).sort()).toEqual([
      'a.md',
      'docs/c.md',
      'work/b.md',
    ]);
    const connectedGraph = filterGraph(snapshot, { tag: '', folder: '', showIsolated: false });
    expect(localGraph(snapshot, 'work/b.md', 2)).toEqual(connectedGraph);
    expect(localGraph(snapshot, null, 2)).toEqual({ pages: [], links: [] });
  });

  it('highlights the selected page and its adjacent nodes and edges', () => {
    const positions = new Map(
      snapshot.pages.map((item) => [
        item.path,
        { ...item, x: item.path.length * 10, y: item.path.length * 7 },
      ]),
    );
    const elements = graphElements(snapshot, positions, 'a.md');
    const node = new Map(elements.nodes.map((item) => [item.id, item.data]));

    expect(node.get('a.md')).toMatchObject({ selected: true, highlighted: true, dimmed: false });
    expect(node.get('work/b.md')).toMatchObject({ selected: false, highlighted: true, dimmed: false });
    expect(node.get('docs/c.md')).toMatchObject({ selected: false, highlighted: false, dimmed: true });
    expect(elements.edges.find((edge) => edge.id === 'a.md=>work/b.md')).toMatchObject({
      animated: true,
    });
  });

  it('keeps a 500-node / 2000-link layout finite and bounded', () => {
    const pages = Array.from({ length: 500 }, (_, index) => page(`page-${index}.md`));
    const links = Array.from({ length: 2000 }, (_, index) => ({
      source: `page-${Math.floor(index / 4)}.md`,
      target: `page-${(Math.floor(index / 4) + (index % 4) + 1) % 500}.md`,
    }));
    const started = performance.now();
    const positions = layoutGraph({ pages, links }, { width: 1200, height: 760 });
    const layoutMs = performance.now() - started;

    expect(positions).toHaveLength(500);
    expect([...positions.values()].every((item) => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(true);
    console.log(`[bench] deterministic 500-node layout=${layoutMs.toFixed(2)}ms`);
    expect(layoutMs).toBeLessThan(4_000);
  }, 20_000);
});
