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
      { externalPath, data, name, targetDir },
      services,
    ): Promise<Result<{ path: string; sha256: string } | null>> => {
      let sourcePath = externalPath;
      // 未带来源时经现有 dialogs.pickFile 策略选择 vault 外 .docx；取消返回 null。
      if (!sourcePath && !data) {
        sourcePath =
          (await services.dialogs.pickFile([{ name: 'Word 文档', extensions: ['docx'] }])) ??
          undefined;
        if (!sourcePath) return ok(null);
      }
      const result = await service(services).importDocx(
        { externalPath: sourcePath, base64: data, name },
        targetDir ?? '',
      );
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
