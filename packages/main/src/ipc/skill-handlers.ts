import { ok, type Result } from '@nexnote/shared';
import type { SkillView } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';

/**
 * skills:* IPC（DEV-014 检索 Skill 系统）。
 * 启停/排序/参数变更后推送 skills:changed；召回经 SkillService 多 Skill 合并重排。
 */
export function registerSkillHandlers(registrar: IpcRegistrar): void {
  registrar.register('skills:list', (_p, s) => {
    if (!s.skills) return ok([] as SkillView[]);
    return ok(s.skills.list());
  });
  registrar.register('skills:setEnabled', (payload, s): Result<SkillView> => {
    if (!s.skills) throw new Error('Skill 服务不可用');
    const view = s.skills.setEnabled(payload.id, payload.enabled);
    s.windows.sendToMainWindow('skills:changed', { reason: 'enabled' });
    return ok(view);
  });
  registrar.register('skills:setOrder', (payload, s) => {
    if (!s.skills) throw new Error('Skill 服务不可用');
    const views = s.skills.setOrder(payload.order);
    s.windows.sendToMainWindow('skills:changed', { reason: 'order' });
    return ok(views);
  });
  registrar.register('skills:setParams', (payload, s): Result<SkillView> => {
    if (!s.skills) throw new Error('Skill 服务不可用');
    const view = s.skills.setParams(payload.id, payload.params);
    s.windows.sendToMainWindow('skills:changed', { reason: 'params' });
    return ok(view);
  });
  registrar.register('skills:retrieve', async (payload, s) => {
    if (!s.skills) {
      return ok({
        query: payload.query,
        usedSkillIds: [],
        sources: [],
        degraded: false,
        contextText: '',
      });
    }
    return ok(await s.skills.retrieve(payload));
  });
}
