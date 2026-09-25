import type { AgentScenario, AgentToolDefinition, ChatPermissionMode } from '@nexnote/shared';
export class ToolRegistryError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ToolRegistryError';
  }
}
export interface ToolContext {
  runId: string;
  scenario: AgentScenario;
  permissionMode?: ChatPermissionMode;
}
export interface AgentTool {
  definition: AgentToolDefinition;
  /** Registry namespace allows Retrieval Skills and Agent tools to share one seam. */
  source?: 'agent' | 'skill';
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}
/** DEV-040 enables only the explicitly registered document tools. */
export const WRITE_TOOLS_ENABLED = true;
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  constructor(initial: AgentTool[] = []) {
    initial.forEach((tool) => this.register(tool));
  }
  register(tool: AgentTool): void {
    if (this.tools.has(tool.definition.name))
      throw new ToolRegistryError(`工具重复注册: ${tool.definition.name}`, 'TOOL_DUPLICATE');
    this.tools.set(tool.definition.name, tool);
  }
  registerAll(tools: AgentTool[]): void {
    tools.forEach((tool) => this.register(tool));
  }
  registerSkill(tool: AgentTool): void {
    this.register({ ...tool, source: 'skill' });
  }
  registerAgentTool(tool: AgentTool): void {
    this.register({ ...tool, source: 'agent' });
  }
  list(): AgentToolDefinition[] {
    return [...this.tools.values()].map((t) => ({ ...t.definition }));
  }
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolRegistryError(`工具不存在: ${name}`, 'TOOL_NOT_FOUND');
    const def = tool.definition;
    if (def.access === 'write' && (!WRITE_TOOLS_ENABLED || ctx.permissionMode === undefined))
      throw new ToolRegistryError(`写工具已禁用: ${name}`, 'TOOL_WRITE_DISABLED');
    return tool.execute(input, ctx);
  }
}
