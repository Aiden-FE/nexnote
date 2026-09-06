import type { RetrievalOptions, RetrievalResponse } from '@nexnote/shared';
import { invoke } from '../../../lib/ipc';

/** DEV-011 三阶段召回：走主进程向量索引 + FTS + 双链。 */
export function retrieve(options: RetrievalOptions): Promise<RetrievalResponse> {
  return invoke('ai:retrieve', options);
}
