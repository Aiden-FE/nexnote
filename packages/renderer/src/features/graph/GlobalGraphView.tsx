import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useIndexStore } from '../../stores/index-store';
import { useTabStore } from '../../stores/tab-store';
import {
  filterGraph,
  graphElements,
  layoutGraph,
  uniqueFolders,
  uniqueTags,
} from './model';
import { graphNodeTypes } from './GraphPageNode';

export function GlobalGraphView() {
  const graph = useIndexStore((state) => state.graph);
  const status = useIndexStore((state) => state.graphStatus);
  const loadGraph = useIndexStore((state) => state.loadGraph);
  const [tag, setTag] = useState('');
  const [folder, setFolder] = useState('');
  const [showIsolated, setShowIsolated] = useState(true);
  const [hoverPath, setHoverPath] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'idle' || status === 'stale' || status === 'error') void loadGraph();
  }, [status, loadGraph]);

  const filtered = useMemo(
    () => filterGraph(graph, { tag, folder, showIsolated }),
    [graph, tag, folder, showIsolated],
  );
  const positions = useMemo(
    () => layoutGraph(filtered, { width: 1200, height: 760 }),
    [filtered],
  );
  const elements = useMemo(() => graphElements(filtered, positions, hoverPath), [filtered, positions, hoverPath]);
  const [nodes, setNodes, onNodesChange] = useNodesState(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  useEffect(() => {
    setNodes(elements.nodes);
    setEdges(elements.edges);
  }, [elements, setEdges, setNodes]);

  return (
    <div data-testid="global-graph-view" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <strong className="text-sm">知识图谱</strong>
        <span className="text-xs text-muted-foreground">
          {status === 'loading' ? '索引更新中…' : `${filtered.pages.length} 页面 · ${filtered.links.length} 链接`}
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          标签
          <select
            data-testid="graph-tag-filter"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            className="h-7 rounded border bg-card px-1 text-xs"
          >
            <option value="">全部</option>
            {uniqueTags(graph).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          文件夹
          <select
            data-testid="graph-folder-filter"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            className="h-7 max-w-42 rounded border bg-card px-1 text-xs"
          >
            <option value="">全部</option>
            {uniqueFolders(graph).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showIsolated}
            onChange={(event) => setShowIsolated(event.target.checked)}
            className="size-3.5"
          />
          孤立页面
        </label>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={graphNodeTypes}
          onNodeMouseEnter={(_, node) => setHoverPath(node.id)}
          onNodeMouseLeave={() => setHoverPath(null)}
          onNodeClick={(_, node) => useTabStore.getState().openPageTab(useTabStore.getState().activePaneId, node.id)}
          minZoom={0.08}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          nodesDraggable
          panOnDrag
          zoomOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {status === 'error' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            图谱索引不可用，请稍后重试
          </div>
        )}
      </div>
    </div>
  );
}
