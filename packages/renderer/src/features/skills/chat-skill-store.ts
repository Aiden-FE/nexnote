import { useSyncExternalStore } from 'react';

/**
 * 对话面板的 Skill 组合选择（DEV-014）。
 * 空选择 = 使用全部已启用 Skill（默认）；非空 = 仅这些 Skill 参与合并重排。
 * 发送时由 chat-runtime 经 retrieve({skillIds}) 透传给主进程 SkillService。
 */
type Listener = () => void;
let selected: string[] = [];
let snapshot: string[] = selected;
const listeners = new Set<Listener>();

function emit(): void {
  snapshot = selected;
  listeners.forEach((listener) => listener());
}

export function setSelectedSkillIds(ids: string[]): void {
  selected = [...ids];
  emit();
}

/** 供非 React 代码（chat-runtime）读取；返回 undefined 表示默认（全部启用）。 */
export function getSelectedSkillIds(): string[] | undefined {
  return snapshot.length > 0 ? [...snapshot] : undefined;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedSkillIds(): string[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
