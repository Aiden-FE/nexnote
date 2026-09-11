import { ok } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { AgentGateway } from '../agent/gateway';

/**
 * agent:* 命名空间 handler。AgentGateway 是唯一的模型执行入口：
 * 渲染层不能携带 provider/profile/model 选择权，scenario 由通道本身决定。
 */
export function registerAgentHandlers(registrar: IpcRegistrar, agent: AgentGateway): void {
  registrar.register('agent:run:chat', async (payload) => ok(await agent.run('chat', payload)));
  registrar.register('agent:run:writing', async (payload) =>
    ok(await agent.run('writing', payload)),
  );
  registrar.register('agent:run:debug', async (payload) => ok(await agent.run('debug', payload)));

  registrar.register('agent:cancel', async (payload) => {
    return ok({ cancelled: agent.cancel(payload.runId) });
  });

  registrar.register('agent:approval:respond', async (payload) => {
    return ok({ accepted: agent.respondApproval(payload.approvalId, payload.decision) });
  });
}
