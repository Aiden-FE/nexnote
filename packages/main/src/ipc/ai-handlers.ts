import { ok } from '@nexnote/shared';
import type { Result } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { AiService } from '../ai/ai-service';

/** ai:* 命名空间 handler。密钥安全契约：任何响应都不含密钥明文。 */
export function registerAiHandlers(registrar: IpcRegistrar, ai: AiService): void {
  registrar.register(
    'ai:getState',
    async (): Promise<Result<ReturnType<AiService['getState']>>> => {
      return ok(ai.getState());
    },
  );

  registrar.register('ai:credential:submit', async (payload) => {
    return ok({ credentialToken: ai.submitCredential(payload.secret, payload.baseUrl) });
  });

  registrar.register(
    'ai:profile:save',
    async (payload): Promise<Result<{ id: string; state: ReturnType<AiService['getState']> }>> => {
      const { id, profile } = payload;
      return ok(ai.saveProfile(id, profile));
    },
  );

  registrar.register('ai:profile:delete', async (payload) => {
    return ok(ai.deleteProfile(payload.id));
  });

  registrar.register('ai:profile:setDefault', async (payload) => {
    return ok(ai.setDefaultProfile(payload.id));
  });

  registrar.register('ai:features:set', async (payload) => {
    return ok(ai.setFeatureAssignment(payload.feature, payload.assignment));
  });

  registrar.register('ai:testConnection', async (payload) => {
    return ok(await ai.testConnection(payload));
  });

  registrar.register('ai:listModels', async (payload) => {
    return ok({ models: await ai.listModels(payload) });
  });

  registrar.register('ai:chat:complete', async (payload) => {
    return ok(await ai.chatCompletion(payload));
  });

  registrar.register('ai:chat:stream:start', async (payload) => {
    return ok({ streamId: ai.startChatStream(payload) });
  });

  registrar.register('ai:chat:stream:cancel', async (payload) => {
    return ok({ cancelled: ai.cancelChatStream(payload.streamId) });
  });

  registrar.register('ai:embed', async (payload) => {
    return ok(await ai.embed(payload.texts));
  });

  registrar.register('ai:embedWithMetadata', async (payload) => {
    return ok(await ai.embedWithMetadata(payload.texts));
  });

  registrar.register('ai:retrieve', async (payload, services) => {
    if (!services.retrieval) {
      return ok({
        query: payload.query,
        degraded: true,
        model: null,
        contextText: '',
        sources: [],
        stages: [
          { stage: 'fts', candidates: 0, elapsedMs: 0, enabled: false },
          { stage: 'links', candidates: 0, elapsedMs: 0, enabled: false },
          { stage: 'vector', candidates: 0, elapsedMs: 0, enabled: false, note: '召回服务不可用' },
        ],
      });
    }
    return ok(await services.retrieval.retrieve(payload));
  });

  registrar.register('ai:export', async () => {
    return ok(ai.exportProfiles());
  });

  registrar.register('ai:import', async (payload) => {
    return ok(ai.importProfiles(payload.json));
  });
}
