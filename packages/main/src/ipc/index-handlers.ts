import { ok, type ConfidenceResult, type GraphSnapshot, type IndexStatus, type Result } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import { readVaultConfig, writeVaultConfig } from '../vault/vault-manager';

/** DEV-004 index:* IPC facade. SQLite access never crosses the renderer boundary. */
export function registerIndexHandlers(registrar: IpcRegistrar): void {
  registrar.register('index:status', (_payload, services): Result<IndexStatus> => ok(services.index.status));
  registrar.register('index:rebuild', (_payload, services) => ok(services.index.rebuild()));
  registrar.register('index:backlinks', ({ pagePath }, services) => ok(services.index.backlinks(pagePath)));
  registrar.register('index:search', ({ query, limit }, services) => ok(services.index.search(query, limit)));
  registrar.register('index:jumpTo', ({ query, limit }, services) => ok(services.index.jumpTo(query, limit)));
  registrar.register('index:tags', ({ flat }, services) => ok(services.index.tags(flat)));
  registrar.register('index:tagPages', ({ tag }, services) => ok(services.index.tagPages(tag)));
  registrar.register('index:pageSummary', ({ path }, services) => ok(services.index.pageSummary(path)));
  registrar.register('index:pageSummaries', (_payload, services) => ok(services.index.pageSummaries()));
  registrar.register('index:graph', (_payload, services): Result<GraphSnapshot> => ok(services.index.graph()));
  registrar.register('index:confidence', ({ pageId }, services): Result<ConfidenceResult | null> => ok(services.index.getConfidence(pageId)));
  registrar.register('index:confidenceSettings', async (_payload, services) => {
    const current = services.vaultSession.getCurrent();
    if (!current) return ok({ writeFrontmatter: false });
    const config = await readVaultConfig(current.root);
    return ok({ writeFrontmatter: config.features.confidenceFrontmatter });
  });
  registrar.register('index:setConfidenceFrontmatter', async ({ enabled }, services) => {
    const current = services.vaultSession.getCurrent();
    if (!current) return { ok: false, error: '尚未打开任何 vault', code: 'NO_VAULT' };
    const config = await readVaultConfig(current.root);
    config.features.confidenceFrontmatter = enabled === true;
    await writeVaultConfig(current.root, config);
    services.git.scheduleAutoCommit('保存置信度设置');
    await services.confidence?.refresh();
    return ok({ writeFrontmatter: config.features.confidenceFrontmatter });
  });
}
