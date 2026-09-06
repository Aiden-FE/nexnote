import { useEffect, useMemo, useState } from 'react';
import { Network } from 'lucide-react';
import { ReactFlow, Background, BackgroundVariant, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { sidebarPanelRegistry } from '../../registries';
import { useIndexStore } from '../../stores/index-store';
import { useTabStore } from '../../stores/tab-store';
import { graphElements, layoutGraph, localGraph } from './model';
import { graphNodeTypes } from './GraphPageNode';

sidebarPanelRegistry.register({
  id: 'graph',
  title: '图谱',
  icon: Network,
  render: LocalGraphPanel,
});

function LocalGraphPanel() {
  const graph = useIndexStore((state) => state.graph);
  const status = useIndexStore((state) => state.graphStatus);
  const loadGraph = useIndexStore((state) => state.loadGraph);
  const panes = useTabStore((state) => state.panes);
  const activePaneId = useTabStore((state) => state.activePaneId);
  const [hops, setHops] = useState<1 | 2>(1);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const activePane = panes[activePaneId];
  const activeTab = activePane?.tabs.find((tab) => tab.id === activePane.activeTabId);
  const center = activeTab?.pagePath ?? null;

  useEffect(() => {
    if (status === 'idle' || status === 'stale' || status === 'error') void loadGraph();
  }, [status, loadGraph]);

  const local = useMemo(() => localGraph(graph, center, hops), [graph, center, hops]);
  const positions = useMemo(() => layoutGraph(local, { width: 560, height: 420, iterations: 90 }), [local]);
  const elements = useMemo(() => graphElements(local, positions, hoverPath), [local, positions, hoverPath]);
  const [nodes, setNodes, onNodesChange] = useNodesState(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  useEffect(() => {
    setNodes(elements.nodes);
    setEdges(elements.edges);
  }, [elements, setEdges, setNodes]);

  return (
    <div data-testid="sidebar-panel-graph" className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
        <span className="mr-auto truncate">局部图谱 · {local.pages.length} 页面</span>
        {[1, 2].map((depth) => (
          <button
            key={depth}
            type="button"
            data-testid={`graph-hops-${depth}`}
            onClick={() => setHops(depth as 1 | 2)}
            className={`rounded border px-1.5 py-0.5 ${hops === depth ? 'border-primary bg-primary/15 text-primary' : 'hover:bg-accent'}`}
          >
            {depth} 跳
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border bg-card">
        {center ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={graphNodeTypes}
            onNodeMouseEnter={(_, node) => setHoverPath(node.id)}
            onNodeMouseLeave={() => setHoverPath(null)}
            onNodeClick={(_, node) => useTabStore.getState().openPageTab(activePaneId, node.id)}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            nodesDraggable
            zoomOnScroll={false}
            panOnDrag
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          </ReactFlow>
        ) : (
          <p className="p-3 text-xs leading-relaxed text-muted-foreground">打开一个页面后显示 1-2 跳邻居。</p>
        )}
      </div>
    </div>
  );
}
