import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { SkillView } from '@nexnote/shared';
import { invoke } from '../../lib/ipc';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { setSelectedSkillIds, useSelectedSkillIds } from './chat-skill-store';

/** 对话 dock 工具栏的 Skill 组合选择器（多选，空 = 全部已启用）。 */
export function ChatSkillPicker() {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const selected = useSelectedSkillIds();

  useEffect(() => {
    if (!open) return;
    void invoke('skills:list')
      .then((list) => setSkills(list.filter((skill) => skill.available)))
      .catch(() => setSkills([]));
  }, [open]);

  const enabled = skills.filter((skill) => skill.enabled);
  const toggle = (id: string): void => {
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    setSelectedSkillIds(next);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        data-testid="chat-skill-picker"
        className={cn('h-7 gap-1 px-2 text-[11px]', selected.length > 0 && 'text-primary')}
        onClick={() => setOpen((value) => !value)}
        title="选择参与召回的检索 Skill（组合后合并重排）"
      >
        <Sparkles className="size-3.5" />
        Skill{selected.length > 0 ? ` · ${selected.length}` : ''}
      </Button>
      {open && (
        <div
          data-testid="chat-skill-menu"
          className="absolute bottom-9 left-0 z-50 w-60 rounded-lg border bg-popover p-2 shadow-xl"
        >
          <p className="px-1 pb-1 text-[10px] text-muted-foreground">
            勾选要组合的检索 Skill；不勾选则使用全部已启用。
          </p>
          {enabled.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">暂无已启用 Skill</p>
          ) : (
            enabled.map((skill) => (
              <label
                key={skill.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-accent"
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={selected.includes(skill.id)}
                  onChange={() => toggle(skill.id)}
                  data-testid={`chat-skill-option-${skill.id}`}
                />
                <span>{skill.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {skill.source === 'builtin' ? '内置' : '插件'}
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
