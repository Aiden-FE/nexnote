import { useEffect, useState } from 'react';
import { Download, RefreshCw, Rocket } from 'lucide-react';
import type { UpdateChannel, UpdateCheckResult } from '@nexnote/shared';
import { settingsSectionRegistry } from '../../registries';
import { invoke, onEvent } from '../../lib/ipc';

settingsSectionRegistry.register({
  id: 'updates',
  title: '更新',
  icon: Download,
  order: 90,
  render: UpdateSettingsSection,
});

/**
 * DEV-018 更新设置分区。
 * DEV-016 的设置页容器会读取同一 registry，无需改动 updater 代码即可接入。
 */
export function UpdateSettingsSection() {
  const [channel, setChannel] = useState<UpdateChannel>(() =>
    (localStorage.getItem('nexnote.update.channel') as UpdateChannel | null) ?? 'stable',
  );
  const [autoDownload, setAutoDownload] = useState(() => localStorage.getItem('nexnote.update.autoDownload') === 'true');
  const [status, setStatus] = useState<UpdateCheckResult>({ status: 'not-configured', channel: 'stable' });
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onEvent('app:updateStatus', (next) => {
        setStatus(next);
        setProgress(next.progress ?? null);
        setBusy(next.status === 'checking' || next.status === 'downloading');
        if (next.status === 'available' && localStorage.getItem('nexnote.update.autoDownload') === 'true') {
          void invoke('app:downloadUpdate');
        }
      }),
    [],
  );

  const action = async (fn: () => Promise<UpdateCheckResult>): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await fn());
    } catch (e) {
      setStatus({ status: 'error', message: e instanceof Error ? e.message : String(e), channel });
    } finally {
      setBusy(false);
    }
  };

  const changeChannel = async (next: UpdateChannel): Promise<void> => {
    setChannel(next);
    localStorage.setItem('nexnote.update.channel', next);
    await action(() => invoke('app:setUpdateChannel', { channel: next }));
  };

  return (
    <section className="space-y-4 text-sm" data-testid="update-settings">
      <div>
        <h3 className="text-base font-medium">应用更新</h3>
        <p className="text-muted-foreground">按通道检查 GitHub Releases；下载完成后由你确认重启安装。</p>
      </div>
      <label className="flex items-center justify-between gap-4">
        <span>更新通道</span>
        <select
          value={channel}
          disabled={busy}
          onChange={(event) => void changeChannel(event.target.value as UpdateChannel)}
          className="rounded border bg-background px-2 py-1"
        >
          <option value="stable">Stable</option>
          <option value="beta">Beta</option>
          <option value="alpha">Alpha</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4">
        <span>
          自动下载
          <small className="block text-muted-foreground">检测到新版本后后台下载，安装仍需确认</small>
        </span>
        <input
          type="checkbox"
          checked={autoDownload}
          onChange={(event) => {
            setAutoDownload(event.target.checked);
            localStorage.setItem('nexnote.update.autoDownload', String(event.target.checked));
          }}
        />
      </label>
      <div className="rounded border p-3">
        <p className="font-medium">{status.message ?? '尚未检查更新'}</p>
        {status.version && <p className="text-xs text-muted-foreground">版本 {status.version}</p>}
        {progress !== null && (
          <div className="mt-2 h-2 overflow-hidden rounded bg-muted" aria-label={`下载进度 ${Math.round(progress)}%`}>
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void action(() => invoke('app:checkForUpdates'))} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 disabled:opacity-50">
          <RefreshCw className="size-3.5" /> 检查更新
        </button>
        {status.status === 'available' && (
          <button type="button" disabled={busy} onClick={() => void action(() => invoke('app:downloadUpdate'))} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50">
            <Download className="size-3.5" /> 下载
          </button>
        )}
        {status.status === 'downloaded' && (
          <button type="button" onClick={() => void invoke('app:installUpdate')} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-primary-foreground">
            <Rocket className="size-3.5" /> 重启并安装
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">自动检查在应用启动 5 秒后执行；自动下载默认关闭，避免消耗带宽。下载完成后退出应用也会自动安装。</p>
    </section>
  );
}
