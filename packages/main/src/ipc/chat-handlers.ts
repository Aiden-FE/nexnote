import { ok, type Result } from '@nexnote/shared';
import type { ChatSession, ChatSessionStatus, ChatSummary, FileInfo } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { ChatService } from '../chat/chat-service';

/** chat:* — AI 会话内部 JSONL 存储（ADR-0007）。 */
export function registerChatHandlers(registrar: IpcRegistrar): void {
  const service = (services: IpcServices): ChatService =>
    new ChatService(services.fs, () => services.vaultSession.getCurrent()?.root ?? null);

  registrar.register('chat:list', async ({ query }, services): Promise<Result<ChatSummary[]>> =>
    ok(await service(services).listChats(query)),
  );

  registrar.register(
    'chat:get',
    async (
      { path },
      services,
    ): Promise<Result<ChatSession & { status: ChatSessionStatus; error?: string }>> =>
      ok(await service(services).getChat(path)),
  );

  registrar.register('chat:new', async ({ title }, services): Promise<Result<ChatSession>> =>
    ok(await service(services).newChat(title)),
  );

  registrar.register(
    'chat:save',
    async ({ session, status, error }, services): Promise<Result<FileInfo>> =>
      // 会话位于 .nexnote/（不受 Git 跟踪），保存不触发自动提交。
      ok(await service(services).saveChat(session, status, error)),
  );

  registrar.register(
    'chat:saveAsDoc',
    async ({ path, userAsQuote }, services): Promise<Result<FileInfo>> => {
      const result = await service(services).saveAsDocument(path, userAsQuote ?? true);
      services.git.scheduleAutoCommit(`导出会话为文档 ${result.path}`);
      try {
        services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      } catch {
        // 写盘已成功；Git 状态栏为咨询性，失败不影响导出结果。
      }
      return ok(result);
    },
  );
}
