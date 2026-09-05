import { createContext, useContext } from 'react';
import type { VaultInfo } from '@nexnote/shared';

/** 当前窗口绑定的 vault（App 层提供，任何插槽组件可消费）。 */
export const VaultContext = createContext<VaultInfo | null>(null);

export function useVault(): VaultInfo | null {
  return useContext(VaultContext);
}
