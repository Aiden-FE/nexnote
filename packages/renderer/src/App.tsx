import { useCallback, useEffect, useState } from 'react';
import type { RecentVaultEntry, VaultInfo } from '@nexnote/shared';
import { invoke, onEvent } from './lib/ipc';
import { ThemeProvider } from './theme/ThemeProvider';
import { VaultContext } from './shell/vault-context';
import { WorkspaceView } from './shell/WorkspaceView';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { CommandPalette, useCommandPaletteHotkey } from './palette/CommandPalette';

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

  useEffect(() => {
    const saveAndCommit = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (state.phase !== 'ready') return;

        // This app-wide save event lets every mounted editor register its async
        // persistence work. Commit starts only after all listeners settle, so
        // Ctrl/Cmd+S is not limited to the timeline message input.
        const saves: Promise<unknown>[] = [];
        window.dispatchEvent(
          new CustomEvent('nexnote:save', {
            detail: { waitUntil: (save: Promise<unknown>) => saves.push(save) },
          }),
        );
        void Promise.all(saves).then(() => invoke('git:commit', { message: '保存当前工作区' }));
      }
    };
    window.addEventListener('keydown', saveAndCommit);
    return () => window.removeEventListener('keydown', saveAndCommit);
  }, [state.phase]);

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
      </VaultContext.Provider>
    </ThemeProvider>
  );
}

export default App;
