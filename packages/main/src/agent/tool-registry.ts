import type { AgentScenario, AgentToolDefinition } from '@nexnote/shared';
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
}
export interface AgentTool {
  definition: AgentToolDefinition;
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
}
export const WRITE_TOOLS_ENABLED = false;
export class ToolRegistry {
  constructor(private readonly tools: AgentTool[]) {}
  list(): AgentToolDefinition[] {
    return this.tools.map((t) => ({ ...t.definition }));
  }
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.find((t) => t.definition.name === name);
    if (!tool) throw new ToolRegistryError(`工具不存在: ${name}`, 'TOOL_NOT_FOUND');
    const def = tool.definition;
    if (def.access === 'write' && !WRITE_TOOLS_ENABLED)
      throw new ToolRegistryError(`写工具已禁用: ${name}`, 'TOOL_WRITE_DISABLED');
    return tool.execute(input, ctx);
  }
}
