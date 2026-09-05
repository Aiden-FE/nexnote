import type { IpcMainLike } from './registrar';
import { createIpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { registerAppHandlers, registerNamespacePingHandlers } from './app-handlers';
import { registerVaultHandlers } from './vault-handlers';
import { registerFsHandlers } from './fs-handlers';
import { registerAiHandlers } from './ai-handlers';

/** 注册全部命名空间 handler。新增命名空间 = 新增文件 + 在这里追加一行。 */
export function registerAllIpcHandlers(ipcMain: IpcMainLike, services: IpcServices) {
  const registrar = createIpcRegistrar(ipcMain, services);
  registerAppHandlers(registrar);
  registerVaultHandlers(registrar);
  registerFsHandlers(registrar);
  registerAiHandlers(registrar, services.ai);
  registerNamespacePingHandlers(registrar);
  return registrar;
}

export { createIpcRegistrar } from './registrar';
export type { IpcRegistrar, IpcHandler, IpcMainLike } from './registrar';
export type { IpcServices } from './services';
