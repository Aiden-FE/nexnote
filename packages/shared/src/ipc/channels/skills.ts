import type { Result } from '../result';
import type {
  SkillParams,
  SkillRetrieveOptions,
  SkillRetrieveResponse,
  SkillView,
} from '../../types/skill';

/**
 * skills:* 命名空间（DEV-014 检索 Skill 系统）。
 * Skill = 受约束扩展，只暴露 retrieval:* 召回；主进程负责多 Skill 合并重排，
 * 渲染层只消费结果与启停/排序/参数配置。插件沙箱内召回为 stretch（available:false）。
 */
export const SKILLS_CHANNELS = [
  'skills:ping',
  'skills:list',
  'skills:setEnabled',
  'skills:setOrder',
  'skills:setParams',
  'skills:retrieve',
] as const;

export type SkillsChannel = (typeof SKILLS_CHANNELS)[number];

export interface SkillsChannelMap {
  'skills:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'skills'; implementedBy: 'DEV-014' }>;
  };
  'skills:list': { request: void; response: Result<SkillView[]> };
  'skills:setEnabled': { request: { id: string; enabled: boolean }; response: Result<SkillView> };
  'skills:setOrder': { request: { order: string[] }; response: Result<SkillView[]> };
  'skills:setParams': {
    request: { id: string; params: SkillParams };
    response: Result<SkillView>;
  };
  'skills:retrieve': { request: SkillRetrieveOptions; response: Result<SkillRetrieveResponse> };
}
