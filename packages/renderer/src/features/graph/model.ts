import type { GraphLink, GraphPage, GraphSnapshot } from '@nexnote/shared';

export interface GraphFilters {
  tag: string;
  folder: string;
  showIsolated: boolean;
}

export interface PositionedPage extends GraphPage {
  x: number;
  y: number;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function adjacency(snapshot: GraphSnapshot): Map<string, Set<string>> {
  const graph = new Map(snapshot.pages.map((page) => [page.path, new Set<string>()]));
  for (const link of snapshot.links) {
    graph.get(link.source)?.add(link.target);
    graph.get(link.target)?.add(link.source);
  }
  return graph;
}

function isDescendant(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`);
}

function connectedPages(snapshot: GraphSnapshot, links: GraphLink[]): Set<string> {
  const connected = new Set<string>();
  for (const link of links) {
    connected.add(link.source);
    connected.add(link.target);
  }
  return connected;
}

export function filterGraph(snapshot: GraphSnapshot, filters: GraphFilters): GraphSnapshot {
  const eligible = snapshot.pages.filter((page) => {
    if (filters.folder && !isDescendant(page.folder, filters.folder)) return false;
    if (filters.tag && !page.tags.some((tag) => isDescendant(tag, filters.tag))) return false;
    return true;
  });
  const eligiblePaths = new Set(eligible.map((page) => page.path));
  const eligibleLinks = snapshot.links.filter(
    (link) => eligiblePaths.has(link.source) && eligiblePaths.has(link.target),
  );
  const connected = connectedPages(snapshot, eligibleLinks);
  const pages = filters.showIsolated
    ? eligible
    : eligible.filter((page) => connected.has(page.path));
  const retained = new Set(pages.map((page) => page.path));
  const links = eligibleLinks.filter((link) => retained.has(link.source) && retained.has(link.target));
  return { pages, links };
}

export function localGraph(snapshot: GraphSnapshot, center: string | null, hops: 1 | 2): GraphSnapshot {
  if (!center) return { pages: [], links: [] };
  const graph = adjacency(snapshot);
  const selected = new Set<string>([center]);
  let frontier = [center];
  for (let depth = 0; depth < hops; depth += 1) {
    frontier = frontier.flatMap((path) => [...graph.get(path) ?? []]);
    frontier.forEach((path) => selected.add(path));
  }
  const pages = snapshot.pages.filter((page) => selected.has(page.path));
  if (!pages.some((page) => page.path === center)) {
    const title = center.split('/').pop()?.replace(/\.md$/i, '') ?? center;
    pages.push({
      path: center,
      title,
      folder: center.includes('/') ? center.slice(0, center.lastIndexOf('/')) : '',
      tags: [],
      inboundLinks: 0,
      outboundLinks: 0,
    });
  }
  const links = snapshot.links.filter((link) => selected.has(link.source) && selected.has(link.target));
  return { pages, links };
}

/**
 * Deterministic bounded spring layout. The sequential O(n²) pass intentionally trades
 * a Web Worker for simplicity at the 500-node ticket scale; the iteration budget keeps
 * interaction startup bounded.
 */
export function layoutGraph(
  snapshot: GraphSnapshot,
  options: { width: number; height: number; iterations?: number } = { width: 1200, height: 800 },
): Map<string, PositionedPage> {
  const { width, height } = options;
  const iterations = options.iterations ?? 160;
  const pages = [...snapshot.pages].sort((a, b) => a.path.localeCompare(b.path));
  const positions = new Map<string, { x: number; y: number }>();
  const radius = Math.min(width, height) * 0.35;
  pages.forEach((page, index) => {
    const seed = hashSeed(page.path);
    const angle = (index / Math.max(1, pages.length)) * Math.PI * 2 + (seed % 100) / 100;
    positions.set(page.path, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    });
  });
  const links = snapshot.links.filter((link) => positions.has(link.source) && positions.has(link.target));
  const restLength = Math.max(90, Math.sqrt((width * height) / Math.max(1, pages.length)) * 0.82);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;
    const force = new Map<string, { x: number; y: number }>();
    pages.forEach((page) => force.set(page.path, { x: 0, y: 0 }));
    const addForce = (path: string, x: number, y: number): void => {
      const value = force.get(path)!;
      value.x += x;
      value.y += y;
    };
    for (let left = 0; left < pages.length; left += 1) {
      for (let right = left + 1; right < pages.length; right += 1) {
        const leftPath = pages[left]!.path;
        const rightPath = pages[right]!.path;
        const leftPosition = positions.get(leftPath)!;
        const rightPosition = positions.get(rightPath)!;
        let dx = leftPosition.x - rightPosition.x;
        let dy = leftPosition.y - rightPosition.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1) {
          dx = ((hashSeed(leftPath) % 7) - 3) || 1;
          dy = ((hashSeed(rightPath) % 7) - 3) || 1;
          distance = Math.hypot(dx, dy);
        }
        const strength = 4_200 / (distance * distance);
        addForce(leftPath, (dx / distance) * strength, (dy / distance) * strength);
        addForce(rightPath, (-dx / distance) * strength, (-dy / distance) * strength);
      }
    }
    for (const link of links) {
      const source = positions.get(link.source)!;
      const target = positions.get(link.target)!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = ((distance - restLength) / distance) * 0.035;
      addForce(link.source, dx * strength, dy * strength);
      addForce(link.target, -dx * strength, -dy * strength);
    }
    for (const page of pages) {
      const position = positions.get(page.path)!;
      const applied = force.get(page.path)!;
      const gravity = 0.006;
      applied.x += (width / 2 - position.x) * gravity;
      applied.y += (height / 2 - position.y) * gravity;
      const displacement = Math.hypot(applied.x, applied.y);
      if (displacement > 1) {
        const maxStep = 42 * cooling;
        const scale = Math.min(displacement, maxStep) / displacement;
        position.x += applied.x * scale;
        position.y += applied.y * scale;
      }
    }
  }
  const xs = pages.map((page) => positions.get(page.path)!.x);
  const ys = pages.map((page) => positions.get(page.path)!.y);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const padding = 72;
  return new Map(pages.map((page) => {
    const position = positions.get(page.path)!;
    return [page.path, {
      ...page,
      x: padding + ((position.x - bounds.minX) / sourceWidth) * (width - padding * 2),
      y: padding + ((position.y - bounds.minY) / sourceHeight) * (height - padding * 2),
    }];
  }));
}

export interface GraphNodeData extends Record<string, unknown> {
  title: string;
  path: string;
  inboundLinks: number;
  outboundLinks: number;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
}

export interface GraphLayoutElements {
  nodes: Array<{
    id: string;
    type: 'graphPage';
    position: { x: number; y: number };
    selected: boolean;
    data: GraphNodeData;
    style: React.CSSProperties;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    animated: boolean;
    style: React.CSSProperties;
  }>;
}

export function graphElements(
  snapshot: GraphSnapshot,
  positions: Map<string, PositionedPage>,
  selectedPath: string | null,
): GraphLayoutElements {
  const neighbors = new Set<string>();
  if (selectedPath) {
    neighbors.add(selectedPath);
    for (const link of snapshot.links) {
      if (link.source === selectedPath) neighbors.add(link.target);
      if (link.target === selectedPath) neighbors.add(link.source);
    }
  }
  return {
    nodes: snapshot.pages.map((page) => {
      const selected = page.path === selectedPath;
      const highlighted = !!selectedPath && neighbors.has(page.path);
      const size = 38 + Math.min(28, page.inboundLinks * 3);
      return {
        id: page.path,
        type: 'graphPage' as const,
        position: { x: positions.get(page.path)?.x ?? 0, y: positions.get(page.path)?.y ?? 0 },
        selected,
        data: {
          title: page.title,
          path: page.path,
          inboundLinks: page.inboundLinks,
          outboundLinks: page.outboundLinks,
          selected,
          highlighted,
          dimmed: !!selectedPath && !highlighted,
        },
        style: {
          width: size,
          height: size,
          borderRadius: '50%',
          border: `2px solid ${selected ? 'var(--primary)' : highlighted ? 'var(--primary)' : 'var(--border)'}`,
          background: selected ? 'var(--primary)' : highlighted ? 'color-mix(in srgb, var(--primary) 18%, transparent)' : 'var(--card)',
        },
      };
    }),
    edges: snapshot.links.map((link) => {
      const highlighted = !!selectedPath && (link.source === selectedPath || link.target === selectedPath);
      return {
        id: `${link.source}=>${link.target}`,
        source: link.source,
        target: link.target,
        animated: highlighted,
        style: {
          stroke: highlighted ? 'var(--primary)' : 'var(--border)',
          strokeWidth: highlighted ? 2.5 : 1,
          opacity: selectedPath && !highlighted ? 0.22 : 1,
        },
      };
    }),
  };
}

export function uniqueFolders(snapshot: GraphSnapshot): string[] {
  return [...new Set(snapshot.pages.map((page) => page.folder))].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function uniqueTags(snapshot: GraphSnapshot): string[] {
  return [...new Set(snapshot.pages.flatMap((page) => page.tags))].sort((a, b) => a.localeCompare(b));
}
