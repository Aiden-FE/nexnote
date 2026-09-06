import { ok, type GraphSnapshot, type IndexStatus, type Result } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';

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
  registrar.register('index:graph', (_payload, services): Result<GraphSnapshot> => ok(services.index.graph()));
}
