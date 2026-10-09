import { useEffect, useState } from 'react';
import type { AppInfo } from '@nexnote/shared';
import { Command, FileCode2, GraduationCap, Link2, Moon, Sparkles, Sun } from 'lucide-react';
import { Button } from '../components/ui/button';
import { invoke } from '../lib/ipc';
import { gettingStartedDocsUrl } from '../lib/product-docs';
import { usePaletteStore } from '../stores/palette-store';
import { useSettingsStore } from '../stores/settings-store';
import { useUiStore } from '../stores/ui-store';
import { useThemeStore } from '../theme/theme-store';
import { useVault } from '../shell/vault-context';
import { useI18n } from '../lib/i18n';

/** 默认欢迎 Tab。 */
export function WelcomePage() {
  const t = useI18n();
  const vault = useVault();
  const setPaletteOpen = usePaletteStore((s) => s.setOpen);
  const toggleTheme = useThemeStore((s) => s.setPreference);
  const resolved = useThemeStore((s) => s.resolved);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const language = useSettingsStore((s) => s.global?.appearance.language);
  const highlights = [
    { icon: FileCode2, text: t('welcome.highlight.views') },
    { icon: Sparkles, text: t('welcome.highlight.ai') },
    { icon: Link2, text: t('welcome.highlight.wikilinks') },
  ];
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const gettingStartedUrl = gettingStartedDocsUrl(language);

  useEffect(() => {
    void invoke('app:getInfo')
      .then(setAppInfo)
      .catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-10 px-8">
      <header className="text-center">
        <div className="flex min-w-0 items-center justify-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            N
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">NexNote</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {vault?.name ?? '—'}
              {appInfo && <span className="opacity-70"> · v{appInfo.version}</span>}
            </p>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t('welcome.title')}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {t('welcome.subtitle')}
        </p>
      </header>

      <div className="flex flex-col items-center gap-2.5">
        <Button
          size="lg"
          className="h-11 w-full max-w-sm text-sm"
          data-testid="welcome-start-tour"
          data-docs-url={gettingStartedUrl}
          onClick={() => window.open(gettingStartedUrl, '_blank', 'noopener')}
        >
          <GraduationCap className="size-4" />
          {t('welcome.gettingStarted')}
        </Button>
        <div className="flex w-full max-w-sm gap-2">
          <Button
            variant="outline"
            size="lg"
            className="h-11 flex-1"
            onClick={() => setPaletteOpen(true)}
          >
            <Command className="size-4" />
            {t('welcome.commandPalette')}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 flex-1"
            aria-label={t('welcome.toggleTheme')}
            onClick={() => toggleTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {t('welcome.theme')}
          </Button>
        </div>
        <button
          type="button"
          onClick={toggleDock}
          className="mt-1 text-[11px] text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('welcome.toggleDock')}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {highlights.map(({ icon: Icon, text }) => (
          <div
            key={text}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[11px] text-muted-foreground"
          >
            <Icon className="size-3.5 shrink-0" />
            {text}
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
        {t('welcome.capabilityLine')}
      </p>
    </div>
  );
}
