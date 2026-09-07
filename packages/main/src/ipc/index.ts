import type { IpcMainLike } from './registrar';
import { createIpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { registerAppHandlers, registerNamespacePingHandlers } from './app-handlers';
import { registerGitHandlers } from './git-handlers';
import { registerVaultHandlers } from './vault-handlers';
import { registerFsHandlers } from './fs-handlers';
import { registerAiHandlers } from './ai-handlers';
import { registerChatHandlers } from './chat-handlers';
import { registerIndexHandlers } from './index-handlers';
import { registerPluginHandlers } from './plugin-handlers';
import { registerSkillHandlers } from './skill-handlers';
import { registerSettingsHandlers } from './settings-handlers';

/** 注册全部命名空间 handler。新增命名空间 = 新增文件 + 在这里追加一行。 */
export function registerAllIpcHandlers(ipcMain: IpcMainLike, services: IpcServices) {
  // Auto-commit completes outside an IPC request; bridge service transitions once.
  services.git.onStatusChanged((status) =>
    services.windows.sendToMainWindow('git:statusChanged', status),
  );
  const registrar = createIpcRegistrar(ipcMain, services);
  registerAppHandlers(registrar);
  registerVaultHandlers(registrar);
  registerFsHandlers(registrar);
  registerAiHandlers(registrar, services.ai);
  registerChatHandlers(registrar);
  registerGitHandlers(registrar);
  registerIndexHandlers(registrar);
  registerPluginHandlers(registrar);
  registerSkillHandlers(registrar);
  registerSettingsHandlers(registrar);
  registerNamespacePingHandlers(registrar);
  return registrar;
}

export { createIpcRegistrar } from './registrar';
export type { IpcRegistrar, IpcHandler, IpcMainLike } from './registrar';
export type { IpcServices } from './services';
