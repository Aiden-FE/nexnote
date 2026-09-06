import { ok, type Result } from '@nexnote/shared';
import type { ChatFolderConfig, ChatSession, ChatSummary, FileInfo } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { ChatService } from '../chat/chat-service';

/** chat:* — 会话即页面（DEV-012）。 */
export function registerChatHandlers(registrar: IpcRegistrar): void {
  const service = (services: IpcServices): ChatService =>
    new ChatService(services.fs, () => services.vaultSession.getCurrent()?.root ?? null);

  const recordWrite = async (services: IpcServices, summary: string): Promise<void> => {
    services.git.scheduleAutoCommit(summary);
    try {
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    } catch {
      // 写盘已成功；Git 状态栏为咨询性，失败不影响会话保存。
    }
  };

  registrar.register('chat:list', async (_payload, services): Promise<Result<ChatSummary[]>> =>
    ok(await service(services).listChats()),
  );

  registrar.register(
    'chat:get',
    async ({ path }, services): Promise<Result<ChatSession>> =>
      ok(await service(services).getChat(path)),
  );

  registrar.register(
    'chat:new',
    async ({ title }, services): Promise<Result<ChatSession>> =>
      ok(await service(services).newChat(title)),
  );

  registrar.register(
    'chat:save',
    async ({ session }, services): Promise<Result<FileInfo>> => {
      const result = await service(services).saveChat(session);
      await recordWrite(services, `AI 会话 ${session.meta.title}`);
      return ok(result);
    },
  );

  registrar.register(
    'chat:saveAsDoc',
    async ({ path, userAsQuote }, services): Promise<Result<FileInfo>> => {
      const result = await service(services).saveAsDocument(path, userAsQuote ?? true);
      await recordWrite(services, `会话转文档 ${result.path}`);
      return ok(result);
    },
  );

  registrar.register(
    'chat:folder:get',
    async (_payload, services): Promise<Result<ChatFolderConfig>> =>
      ok(await service(services).getFolderConfig()),
  );

  registrar.register(
    'chat:folder:set',
    async ({ folder }, services): Promise<Result<ChatFolderConfig>> =>
      ok(await service(services).setFolder(folder)),
  );
}
