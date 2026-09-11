import type { AgentTool } from './tool-registry';

/**
 * 主进程受控只读 NexNote tools。
 * 只暴露存在性/结构查询与检索能力；不提供任意命令、任意文件读写或 MCP 桥接。
 * 工具输入在执行前经 registry/网关校验，且输入不回写审计。
 */

export interface BuiltinToolDeps {
  /** 三阶段检索（DEV-011 RetrievalService.retrieve）。 */
  retrieve: (query: string) => Promise<{
    sources: Array<{ path: string; title: string; snippet: string; score: number }>;
    degraded: boolean;
  }>;
  /** 当前库内页面列表（path + 标题）。 */
  listPages: () => Array<{ path: string; title: string }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readSearchInput(input: unknown): { query: string; topK?: number } {
  if (!isRecord(input) || typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('search_notes 输入必须是 { query: string }');
  }
  const topK =
    input.topK === undefined ? undefined : typeof input.topK === 'number' ? input.topK : undefined;
  return { query: input.query, ...(topK !== undefined ? { topK } : {}) };
}

export function createBuiltinTools(deps: BuiltinToolDeps): AgentTool[] {
  const searchTool: AgentTool = {
    definition: {
      name: 'search_notes',
      description: '在当前知识库内做三阶段检索（FTS + 双链 + 向量重排），返回相关页面片段。',
      access: 'read',
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, topK: { type: 'number' } },
        required: ['query'],
      },
    },
    async execute(input) {
      const { query, topK } = readSearchInput(input);
      const res = await deps.retrieve(query);
      const sources =
        topK && Number.isFinite(topK) && topK > 0 ? res.sources.slice(0, topK) : res.sources;
      return { degraded: res.degraded, sources };
    },
  };

  const listPagesTool: AgentTool = {
    definition: {
      name: 'list_pages',
      description: '列出当前知识库的全部页面（相对路径与标题），用于了解库结构。',
      access: 'read',
      requiresApproval: false,
      inputSchema: { type: 'object', properties: {} },
    },
    async execute() {
      return { pages: deps.listPages() };
    },
  };

  return [searchTool, listPagesTool];
}
