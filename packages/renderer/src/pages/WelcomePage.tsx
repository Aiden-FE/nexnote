import { useEffect, useState } from 'react';
import { invoke } from '../lib/ipc';
import type { AppInfo } from '@nexnote/shared';
import { Command, FolderOpen, Moon, PanelLeft, Sparkles, SplitSquareHorizontal } from 'lucide-react';
import { openTabInActivePane } from '../stores/tab-store';
import { usePaletteStore } from '../stores/palette-store';
import { useUiStore } from '../stores/ui-store';
import { useThemeStore } from '../theme/theme-store';
import { useVault } from '../shell/vault-context';

const hints = [
  { icon: Command, text: '⌘K / Ctrl+K 唤起命令面板' },
  { icon: SplitSquareHorizontal, text: '拖动中间分隔线调整分屏，双击收起' },
  { icon: PanelLeft, text: '拖动侧栏边缘调整宽度，双击折叠' },
  { icon: Moon, text: '命令面板或状态栏可切换亮/暗主题' },
  { icon: Sparkles, text: '右侧 AI 对话 Dock 将在 DEV-012 接入' },
];

/** 默认欢迎 Tab。 */
export function WelcomePage() {
  const vault = useVault();
  const setPaletteOpen = usePaletteStore((s) => s.setOpen);
  const toggleTheme = useThemeStore((s) => s.setPreference);
  const resolved = useThemeStore((s) => s.resolved);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void invoke('app:getInfo').then(setAppInfo).catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 px-8 text-center">
      <div>
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary font-bold text-primary-foreground">
          N
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">欢迎使用 NexNote</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          当前知识库：<span className="font-medium text-foreground">{vault?.name ?? '—'}</span>
          {appInfo && <span className="ml-2 opacity-70">· v{appInfo.version}</span>}
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-2">
        {hints.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            <Icon className="size-4 shrink-0" />
            {text}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => openTabInActivePane('files', 'Vault 文件')}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <FolderOpen className="size-3.5" />
          浏览 Vault 文件
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="rounded-md border bg-background px-3.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          打开命令面板 ⌘K
        </button>
        <button
          type="button"
          onClick={() => toggleTheme(resolved === 'dark' ? 'light' : 'dark')}
          className="rounded-md border bg-background px-3.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          切换主题
        </button>
        <button
          type="button"
          onClick={() => toggleDock()}
          className="rounded-md border bg-background px-3.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          切换 Dock
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        编辑器内核（DEV-002 · TipTap 3）、页面树（DEV-003）、Git 底座（DEV-007）、AI 层（DEV-009+）
        将在后续票据接入本应用壳。
      </p>
    </div>
  );
}
