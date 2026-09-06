import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { GraphNodeData } from './model';

function GraphPageNodeInner({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div
      title={`${data.title}\n${data.path}\n入链 ${data.inboundLinks} · 出链 ${data.outboundLinks}`}
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-full text-center text-[9px] leading-tight"
      style={{ opacity: data.dimmed ? 0.35 : 1 }}
    >
      <span className="line-clamp-2 px-1 font-medium">{data.title}</span>
    </div>
  );
}

export const GraphPageNode = memo(GraphPageNodeInner);

export const graphNodeTypes = { graphPage: GraphPageNode };
