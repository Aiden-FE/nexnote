import { useSyncExternalStore } from 'react';

export interface RegistryEntry {
  id: string;
}

export interface Registry<T extends RegistryEntry> {
  /** 注册条目，返回反注册函数。后续票据用「新增模块文件 + register 调用」扩展 UI。 */
  register(entry: T): () => void;
  unregister(id: string): void;
  get(id: string): T | undefined;
  all(): T[];
  subscribe(listener: () => void): () => void;
}

export function createRegistry<T extends RegistryEntry>(name: string): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  // 稳定快照：getSnapshot 必须返回同一引用，否则 useSyncExternalStore 会反复重渲并发出警告
  let snapshot: T[] = [];
  const rebuild = () => {
    snapshot = [...items.values()];
  };
  const emit = () => listeners.forEach((l) => l());
  return {
    register(entry) {
      if (items.has(entry.id)) {
        console.warn(`[${name} registry] 重复注册: ${entry.id}`);
      }
      items.set(entry.id, entry);
      rebuild();
      emit();
      return () => {
        items.delete(entry.id);
        rebuild();
        emit();
      };
    },
    unregister(id) {
      if (items.delete(id)) {
        rebuild();
        emit();
      }
    },
    get: (id) => items.get(id),
    all: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useRegistryItems<T extends RegistryEntry>(registry: Registry<T>): T[] {
  return useSyncExternalStore(
    (l) => registry.subscribe(l),
    () => registry.all(),
    () => registry.all(),
  );
}
