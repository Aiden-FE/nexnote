import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, RefreshCw, Sparkles } from 'lucide-react';
import type { SkillView } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';
import { cn } from '../../lib/utils';

/**
 * 检索 Skill 设置页（DEV-014）：
 * 内置三阶段检索 + 插件参数化 Skill；启用/禁用、排序（决定组合顺序）、参数配置。
 * 多 Skill 组合召回由主进程合并重排（skills:retrieve）。
 */
export function SkillsSettingsPage() {
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSkills(await invoke('skills:list'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return onEvent('skills:changed', () => void refresh());
  }, [refresh]);

  const move = async (index: number, delta: number): Promise<void> => {
    if (!skills) return;
    const order = skills.map((skill) => skill.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    try {
      setSkills(await invoke('skills:setOrder', { order }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = async (skill: SkillView): Promise<void> => {
    try {
      await invoke('skills:setEnabled', { id: skill.id, enabled: !skill.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setParam = async (
    skill: SkillView,
    key: 'topK' | 'confidenceWeight',
    raw: string,
  ): Promise<void> => {
    const value = raw === '' ? undefined : Number(raw);
    const params = { ...skill.params, [key]: Number.isFinite(value) ? value : undefined };
    try {
      await invoke('skills:setParams', { id: skill.id, params });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (skills === null) {
    return (
      <div className="space-y-3 text-sm" data-testid="skills-settings">
        <p className="text-muted-foreground">加载中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm" data-testid="skills-settings">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
          <Sparkles className="size-4" />
          检索 Skill
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          title="刷新"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        启用的 Skill 在对话召回时各自检索、合并去重并跨源重排；排序决定组合与展示顺序。
      </p>
      <ul className="space-y-2" data-testid="skills-list">
        {skills.map((skill, index) => (
          <li
            key={skill.id}
            data-testid={`skill-row-${skill.id}`}
            className="rounded-lg border bg-card p-3"
          >
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={() => void toggle(skill)}
                  data-testid={`skill-toggle-${skill.id}`}
                  className="size-3.5"
                />
                启用
              </label>
              <span className="font-medium">{skill.name}</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  skill.source === 'builtin'
                    ? 'bg-sky-500/15 text-sky-600'
                    : 'bg-violet-500/15 text-violet-600',
                )}
              >
                {skill.source === 'builtin' ? '内置' : '插件'}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void move(index, -1)}
                  title="上移"
                  data-testid={`skill-up-${skill.id}`}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void move(index, 1)}
                  title="下移"
                  data-testid={`skill-down-${skill.id}`}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </span>
            </div>
            {skill.description && (
              <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                topK
                <input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={skill.params.topK ?? ''}
                  onBlur={(e) => void setParam(skill, 'topK', e.target.value)}
                  data-testid={`skill-topk-${skill.id}`}
                  className="h-7 w-16 rounded border bg-background px-2 text-xs"
                />
              </label>
              <label className="flex items-center gap-1">
                置信度权重
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  defaultValue={skill.params.confidenceWeight ?? ''}
                  onBlur={(e) => void setParam(skill, 'confidenceWeight', e.target.value)}
                  className="h-7 w-16 rounded border bg-background px-2 text-xs"
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
