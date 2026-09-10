import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { ok, type Result } from '@nexnote/shared';
import type { DocxEditCopyPayload, DocxPreviewPayload } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { DocxService } from '../docx/docx-service';

/** docx:* — DOCX 原件只读 / native-block 副本编辑 / 导出新 DOCX（阶段6）。 */
export function registerDocxHandlers(registrar: IpcRegistrar): void {
  const service = (services: IpcServices): DocxService =>
    new DocxService(services.fs, () => services.vaultSession.getCurrent()?.root ?? null);

  const recordWrite = async (services: IpcServices, summary: string): Promise<void> => {
    services.git.scheduleAutoCommit(summary);
    // Git 状态为咨询性，失败不影响已成功的写盘。
    try {
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    } catch {
      // 写盘已成功；状态栏由下一次常规刷新恢复。
    }
  };

  registrar.register(
    'docx:import',
    async (
      { data, name, targetDir },
      services,
    ): Promise<Result<{ path: string; sha256: string } | null>> => {
      // 外部文件来源只经主进程 dialogs.pickFile；renderer 提供的字节走 base64。
      // 不接受 renderer 直接传外部路径，防止任意本地文件被读入 vault。
      if (!data) {
        const picked = await services.dialogs.pickFile([
          { name: 'Word 文档', extensions: ['docx'] },
        ]);
        if (!picked) return ok(null);
        const bytes = await fsp.readFile(picked);
        const result = await service(services).importDocx(
          { base64: bytes.toString('base64'), name: path.basename(picked) },
          targetDir ?? '',
        );
        await recordWrite(services, `导入 DOCX ${result.path}`);
        return ok(result);
      }
      const result = await service(services).importDocx({ base64: data, name }, targetDir ?? '');
      await recordWrite(services, `导入 DOCX ${result.path}`);
      return ok(result);
    },
  );

  registrar.register(
    'docx:readPreview',
    async ({ path }, services): Promise<Result<DocxPreviewPayload>> =>
      ok(await service(services).readPreview(path)),
  );

  registrar.register(
    'docx:createEditCopy',
    async ({ path }, services): Promise<Result<DocxEditCopyPayload>> => {
      const result = await service(services).createEditCopy(path);
      if (result.created) await recordWrite(services, `创建 DOCX 编辑副本 ${result.path}`);
      return ok(result);
    },
  );

  registrar.register(
    'docx:export',
    async ({ path, targetPath }, services): Promise<Result<{ path: string }>> => {
      const result = await service(services).exportDocx(path, targetPath);
      await recordWrite(services, `导出 DOCX ${result.path}`);
      return ok(result);
    },
  );
}
