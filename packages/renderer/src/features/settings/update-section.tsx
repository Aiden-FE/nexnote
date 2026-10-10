import { useEffect, useState } from 'react';
import { Download, RefreshCw, Rocket } from 'lucide-react';
import type {
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateSettings,
  UpdateSettingsPatch,
} from '@nexnote/shared';
import { settingsSectionRegistry } from '../../registries';
import { invoke, onEvent } from '../../lib/ipc';
import { t, useI18n } from '../../lib/i18n';

settingsSectionRegistry.register({
  id: 'updates',
  title: 'settings.section.updates',
  titleIsKey: true,
  icon: Download,
  order: 90,
  render: UpdateSettingsSection,
});

/**
 * DEV-018 更新设置分区。
 * 单一权威原则：channel/autoDownload/checkOnLaunch 都从主进程 AppStore 读取，
 * 不在 renderer localStorage 做第二份真值；设置变更通过 IPC 写回主进程。
 */
export function UpdateSettingsSection() {
  const tr = useI18n();
  const [settings, setSettings] = useState<UpdateSettings>({
    channel: 'stable',
    autoDownload: true,
    checkOnLaunch: true,
  });
  const [status, setStatus] = useState<UpdateCheckResult>({
    status: 'not-configured',
    channel: 'stable',
  });
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await invoke('app:getUpdateSettings');
        if (!cancelled) {
          setSettings(result);
          setLoaded(true);
        }
      } catch {
        // leave defaults when main returns error; keep defaults display until next successful fetch
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onEvent('app:updateStatus', (next) => {
        setStatus(next);
        setProgress(next.progress ?? null);
        setBusy(next.status === 'checking' || next.status === 'downloading');
      }),
    [],
  );

  const action = async (fn: () => Promise<UpdateCheckResult>): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await fn());
    } catch (e) {
      setStatus({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        channel: settings.channel,
      });
    } finally {
      setBusy(false);
    }
  };

  const changeSetting = async (patch: UpdateSettingsPatch): Promise<void> => {
    setBusy(true);
    try {
      const result = await invoke('app:setUpdateSettings', patch);
      setSettings(result);
    } catch (e) {
      setStatus({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        channel: settings.channel,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await invoke('app:installUpdate');
      const install = result as UpdateInstallResult;
      if (install.action === 'manual-download') {
        setStatus({
          status: 'downloaded',
          message: t('updates.manualDownload', { arch: install.arch }),
          channel: settings.channel,
          action: 'manual-download',
          arch: install.arch,
        });
      }
    } catch (e) {
      setStatus({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        channel: settings.channel,
        recoverable: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 text-sm" data-testid="update-settings">
      <div>
        <h3 className="text-base font-medium">{tr('updates.title')}</h3>
        <p className="text-muted-foreground">{tr('updates.description')}</p>
      </div>
      <label className="flex items-center justify-between gap-4">
        <span>{tr('updates.channel')}</span>
        <select
          value={settings.channel}
          disabled={busy || !loaded}
          onChange={(event) =>
            void changeSetting({ channel: event.target.value as UpdateSettings['channel'] })
          }
          className="rounded border bg-background px-2 py-1"
        >
          <option value="stable">Stable</option>
          <option value="beta">Beta</option>
          <option value="alpha">Alpha</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4">
        <span>
          {tr('updates.autoDownload')}
          <small className="block text-muted-foreground">
            {tr('updates.autoDownloadDescription')}
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.autoDownload}
          disabled={busy || !loaded}
          onChange={(event) => void changeSetting({ autoDownload: event.target.checked })}
        />
      </label>
      <label className="flex items-center justify-between gap-4">
        <span>
          {tr('updates.checkOnLaunch')}
          <small className="block text-muted-foreground">
            {tr('updates.checkOnLaunchDescription')}
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.checkOnLaunch}
          disabled={busy || !loaded}
          onChange={(event) => void changeSetting({ checkOnLaunch: event.target.checked })}
        />
      </label>
      <div className="rounded border p-3">
        <p className="font-medium">{status.message ?? tr('updates.statusFallback')}</p>
        {status.version && (
          <p className="text-xs text-muted-foreground">
            {tr('updates.versionLabel', { version: status.version })}
          </p>
        )}
        {progress !== null && (
          <div
            className="mt-2 h-2 overflow-hidden rounded bg-muted"
            aria-label={tr('updates.downloadProgress', { percent: Math.round(progress) })}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void action(() => invoke('app:checkForUpdates'))}
          className="inline-flex items-center gap-1 rounded border px-3 py-1.5 disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" />{' '}
          {status.status === 'error' && status.retry === 'check'
            ? tr('updates.checkRetry')
            : tr('updates.check')}
        </button>
        {(status.status === 'available' && !settings.autoDownload) ||
        (status.status === 'error' && status.retry === 'download') ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(() => invoke('app:downloadUpdate'))}
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
          >
            <Download className="size-3.5" />{' '}
            {status.retry === 'download' ? tr('updates.downloadRetry') : tr('updates.download')}
          </button>
        ) : null}
        {(status.status === 'downloaded' || (status.status === 'error' && status.recoverable)) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleInstall()}
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
          >
            <Rocket className="size-3.5" /> {tr('updates.install')}
          </button>
        )}
        {status.action === 'manual-download' && (
          <p className="w-full text-xs text-muted-foreground" role="status">
            {tr('updates.manualDownloadDetail', { arch: status.arch ?? 'current' })}
            <code className="mx-1 rounded bg-muted px-1">xattr -d com.apple.quarantine</code>
            {tr('updates.manualDownloadAfterCommand')}
          </p>
        )}
        {status.status === 'error' && status.recoverable && (
          <p className="w-full text-xs text-muted-foreground" role="alert">
            {tr('updates.installIncomplete')}
          </p>
        )}
        {status.status === 'error' && status.retry && (
          <p className="w-full text-xs text-muted-foreground" role="alert">
            {status.retry === 'download'
              ? tr('updates.downloadFailedRetry')
              : tr('updates.checkFailedRetry')}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {tr('updates.scheduleNote')}
      </p>
    </section>
  );
}
