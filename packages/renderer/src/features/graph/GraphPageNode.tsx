import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { GraphNodeData } from './model';
import { t } from '../../lib/i18n';

function GraphPageNodeInner({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div
      title={t('graph.node.tooltip', {
        title: data.title,
        path: data.path,
        inbound: data.inboundLinks,
        outbound: data.outboundLinks,
      })}
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-full text-center text-[9px] leading-tight"
      style={{ opacity: data.dimmed ? 0.35 : 1 }}
    >
      <span className="line-clamp-2 px-1 font-medium">{data.title}</span>
    </div>
  );
}

export const GraphPageNode = memo(GraphPageNodeInner);

export const graphNodeTypes = { graphPage: GraphPageNode };
