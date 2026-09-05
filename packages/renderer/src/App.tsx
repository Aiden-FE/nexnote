import { useCallback, useEffect, useState } from 'react';
import type { RecentVaultEntry, VaultInfo } from '@nexnote/shared';
import { invoke, onEvent } from './lib/ipc';
import { ThemeProvider } from './theme/ThemeProvider';
import { VaultContext } from './shell/vault-context';
import { WorkspaceView } from './shell/WorkspaceView';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { CommandPalette, useCommandPaletteHotkey } from './palette/CommandPalette';
import { AiGlobalLayer } from './features/ai';

type StartupState =
  | { phase: 'loading' }
  | { phase: 'onboarding'; recent: RecentVaultEntry[] }
  | { phase: 'ready'; vault: VaultInfo };

function App() {
  const [state, setState] = useState<StartupState>({ phase: 'loading' });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const startup = await invoke('vault:getState');
      if (startup.mode === 'ready') {
        setState({ phase: 'ready', vault: startup.vault });
      } else {
        setState({ phase: 'onboarding', recent: startup.recent });
      }
    } catch (e) {
      console.error('[app] 读取启动状态失败', e);
      setState({ phase: 'onboarding', recent: [] });
    }
  }, []);

  useEffect(() => {
    // 首次加载为异步 IPC 拉取，setState 均在 await 之后（非同步级联渲染）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return onEvent('vault:changed', () => void refresh());
  }, [refresh]);

  useCommandPaletteHotkey();

  return (
    <ThemeProvider>
      <VaultContext.Provider value={state.phase === 'ready' ? state.vault : null}>
        {state.phase === 'loading' && (
          <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
            正在启动 NexNote…
          </div>
        )}
        {state.phase === 'onboarding' && (
          <OnboardingWizard recent={state.recent} onRecentsChanged={() => void refresh()} />
        )}
        {state.phase === 'ready' && <WorkspaceView vault={state.vault} />}
        <CommandPalette />
        <AiGlobalLayer />
      </VaultContext.Provider>
    </ThemeProvider>
  );
}

export default App;
