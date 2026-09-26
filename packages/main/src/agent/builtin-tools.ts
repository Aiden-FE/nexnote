import type {
  GitDoctorRepairExecuteResult,
  GitDoctorRepairPrepareResult,
  GitRepairAction,
} from '@nexnote/shared';
import { GIT_REPAIR_ACTIONS } from '../git/git-sync-doctor';
import type { AgentTool } from './tool-registry';

/**
 * 主进程受控只读 NexNote tools。
 * 只暴露存在性/结构查询与检索能力；不提供任意命令、任意文件读写或 MCP 桥接。
 * 工具输入在执行前经 registry/网关校验，且输入不回写审计。
 */

export interface BuiltinToolDeps {
  /** Controlled document writes; paths are vault-relative and already sandboxed. */
  document?: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<unknown>;
    /** Shared atomic write seam used by full-mode/batch edits. */
    writeTransaction?(writes: Array<{ path: string; content: string }>): Promise<unknown>;
  };
  /** 三阶段检索（DEV-011 RetrievalService.retrieve）。 */
  retrieve: (query: string) => Promise<{
    sources: Array<{ path: string; title: string; snippet: string; score: number }>;
    degraded: boolean;
  }>;
  /** 当前库内页面列表（path + 标题）。 */
  listPages: () => Array<{ path: string; title: string }>;
  /**
   * 注入 Git Sync Doctor：让 Agent 在审批后调 prepare+execute 真正执行 git 修复。
   * 不传则不注册 git_doctor_repair 工具（向后兼容旧 bootstrap）。
   */
  doctor?: DoctorAdapter;
}

/**
 * 把 GitSyncDoctor 的 prepare/execute 包装成 Agent Tool 调用的最小接口，
 * 避免 Agent 工具直接依赖 doctor 类（DI + 易测）。
 */
export interface DoctorAdapter {
  diagnose(): Promise<{ plan: { action: GitRepairAction | null } }>;
  prepare(action: GitRepairAction): Promise<GitDoctorRepairPrepareResult>;
  execute(ticket: string): Promise<GitDoctorRepairExecuteResult>;
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
    source: 'agent',
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
    source: 'agent',
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

  const editSelectionTool: AgentTool = {
    source: 'agent',
    definition: {
      name: 'edit_current_selection',
      description: '将当前上下文文档中的指定选区替换为 Markdown 文本。',
      access: 'write',
      requiresApproval: true,
      batchable: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          expectedText: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'expectedText', 'content'],
      },
    },
    async execute(input) {
      if (!deps.document) throw new Error('文档写入服务不可用');
      if (
        !isRecord(input) ||
        typeof input.path !== 'string' ||
        typeof input.expectedText !== 'string' ||
        typeof input.content !== 'string'
      ) {
        throw new Error('edit_current_selection 输入无效');
      }
      const current = await deps.document.read(input.path);
      const index = current.indexOf(input.expectedText);
      if (index < 0 || current.indexOf(input.expectedText, index + 1) >= 0) {
        throw Object.assign(new Error('选区已变化或不唯一'), { code: 'STALE_SELECTION' });
      }
      const next =
        current.slice(0, index) + input.content + current.slice(index + input.expectedText.length);
      if (deps.document.writeTransaction) {
        await deps.document.writeTransaction([{ path: input.path, content: next }]);
      } else {
        await deps.document.write(input.path, next);
      }
      return { path: input.path, operation: 'replace', chars: input.content.length };
    },
  };
  const appendDocumentTool: AgentTool = {
    source: 'agent',
    definition: {
      name: 'append_to_document',
      description: '向当前上下文文档末尾追加 Markdown 文本。',
      access: 'write',
      requiresApproval: true,
      batchable: true,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
    async execute(input) {
      if (!deps.document) throw new Error('文档写入服务不可用');
      if (!isRecord(input) || typeof input.path !== 'string' || typeof input.content !== 'string')
        throw new Error('append_to_document 输入无效');
      const current = await deps.document.read(input.path);
      const next = current + (current.endsWith('\n') ? '' : '\n') + input.content;
      if (deps.document.writeTransaction) {
        await deps.document.writeTransaction([{ path: input.path, content: next }]);
      } else {
        await deps.document.write(input.path, next);
      }
      return { path: input.path, operation: 'append', chars: input.content.length };
    },
  };
  return [
    searchTool,
    listPagesTool,
    editSelectionTool,
    appendDocumentTool,
    ...createDoctorTools(deps),
  ];
}

/**
 * git_doctor_repair：根据医生诊断推荐的 GitRepairAction 执行修复。
 * access='write' + requiresApproval=true：审批未通过时 gateway 会在 executeTool 拒绝；
 * 审批通过后 ctx.approval.approvalId 会被注入，工具执行 prepare+execute 的安全路径。
 *
 * 即使 action 不在白名单或仓库状态变化，doctor 自身也会抛 INVALID_ACTION / STATE_DRIFT 等
 * 错误；这里只做最小化的输入校验，复杂判断交给 doctor。
 */
function createDoctorTools(deps: BuiltinToolDeps): AgentTool[] {
  if (!deps.doctor) return [];
  const doctor = deps.doctor;
  return [
    {
      source: 'agent',
      definition: {
        name: 'git_doctor_repair',
        description:
          '执行医生已批准的 git 修复动作（commit / pull / push / abort-rebase-or-merge / preserve-local-and-abort / force-abort-rebase-or-merge）。' +
          '内部走 git:doctor:repairPrepare 签发票据、git:doctor:repairExecute 在审批后真正执行（含 TOCTOU + TTL 安全校验）。' +
          '调用前必须先有医生的诊断结果（医生推荐的 action），不要自行决定 action。',
        access: 'write',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...GIT_REPAIR_ACTIONS],
              description: '医生已批准的 GitRepairAction（来自医生诊断的 plan.action 字段）。',
            },
          },
          required: ['action'],
        },
      },
      async execute(input, ctx) {
        if (!isRecord(input) || typeof input.action !== 'string') {
          throw new Error('git_doctor_repair 输入必须是 { action: GitRepairAction }');
        }
        if (!ctx.approval?.approvalId) {
          // gateway 在审批通过后才注入 approvalId；这里是双保险
          throw new Error('git_doctor_repair 必须在审批通过后调用');
        }
        const action = input.action;
        if (!GIT_REPAIR_ACTIONS.includes(action as GitRepairAction)) {
          throw new Error(`git_doctor_repair action 无效: ${action}`);
        }
        const repairAction = action as GitRepairAction;
        const diagnosis = await doctor.diagnose();
        if (diagnosis.plan.action !== repairAction) {
          throw Object.assign(
            new Error(
              `Git Doctor 当前推荐的操作是 ${diagnosis.plan.action ?? '无自动修复'}，拒绝执行 ${repairAction}`,
            ),
            { code: 'DOCTOR_ACTION_MISMATCH' },
          );
        }
        const prepared = await doctor.prepare(repairAction);
        const result = await doctor.execute(prepared.ticket);
        return {
          ticket: prepared.ticket,
          action,
          message: result.message,
          preserve: result.preserve,
        };
      },
    },
  ];
}
