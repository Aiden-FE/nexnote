import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
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
      {/*
       * React Flow 的边根据节点 Handle 计算端点；不注册 Handle 时
       * getEdgePosition() 返回 null，EdgeWrapper 会丢弃全部边。
       * 这里用透明的零视觉占位 Handle 满足边几何，UI 仍由自定义圆形承担。
       */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-px !w-px !min-w-0 !min-h-0 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-px !w-px !min-w-0 !min-h-0 !border-0 !bg-transparent !opacity-0"
      />
      <span className="line-clamp-2 px-1 font-medium">{data.title}</span>
    </div>
  );
}

export const GraphPageNode = memo(GraphPageNodeInner);

export const graphNodeTypes = { graphPage: GraphPageNode };
