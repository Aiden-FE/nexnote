import { useMemo } from 'react';
import { FileText, Gauge, Link2, ListOrdered, Calendar, FolderOpen, Braces } from 'lucide-react';
import type { FrontmatterData } from '@nexnote/kernel';
import { getList, getString, isStandardField, type FrontmatterValue } from '@nexnote/kernel';
import { invoke } from '../../lib/ipc';
import { pageStatistics } from './frontmatter-utils';

export interface PropertiesPanelProps {
  markdown: string;
  data: FrontmatterData;
  filePath: string;
  /** 入链 / 出链数量（本票先用占位，DEV-004 接入真实索引） */
  linkCounts?: { in: number; out: number };
}

/** 右侧「文档属性」面板。 */
export function PropertiesPanel({
  markdown,
  data,
  filePath,
  linkCounts = { in: 0, out: 0 },
}: PropertiesPanelProps) {
  const stats = useMemo(() => pageStatistics(markdown), [markdown]);
  const tags = getList(data, 'tags');
  const aliases = getList(data, 'aliases');
  const confidence = data.confidence;
  const customFields = Object.entries(data)
    .filter(([key]) => !isStandardField(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const showInFinder = () => {
    void invoke('vault:reveal', { path: filePath });
  };

  return (
    <div data-testid="properties-panel" className="space-y-4 text-xs">
      <section>
        <SectionHeader icon={<FileText className="size-3.5" />} title="基本信息" />
        <InfoRow label="文件路径">
          <button
            type="button"
            onClick={showInFinder}
            className="max-w-full truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title={`${filePath}（在 Finder/资源管理器中显示）`}
          >
            {filePath}
          </button>
        </InfoRow>
        <InfoRow label="标题">
          <span className="truncate">{getString(data, 'title') || '（未设置）'}</span>
        </InfoRow>
        <InfoRow label="类型">
          <span className="truncate">{getString(data, 'type') || '普通文档'}</span>
        </InfoRow>
        <InfoRow label="别名">
          {aliases.length === 0 ? (
            <span className="text-muted-foreground">无</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {aliases.map((a) => (
                <span key={a} className="rounded-full border px-1.5 py-0.5 text-[10px]">
                  {a}
                </span>
              ))}
            </div>
          )}
        </InfoRow>
        <InfoRow label="标签">
          {tags.length === 0 ? (
            <span className="text-muted-foreground">无</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </InfoRow>
      </section>

      <section>
        <SectionHeader icon={<Braces className="size-3.5" />} title="自定义字段" />
        {customFields.length === 0 ? (
          <p className="py-1 text-[11px] text-muted-foreground">无自定义字段</p>
        ) : (
          customFields.map(([key, value]) => (
            <InfoRow key={key} label={key}>
              <FrontmatterValueDisplay value={value} />
            </InfoRow>
          ))
        )}
      </section>

      <section>
        <SectionHeader icon={<Gauge className="size-3.5" />} title="置信度（DEV-008 计算）" />
        <ConfidenceDisplay value={confidence} />
      </section>

      <section>
        <SectionHeader icon={<Link2 className="size-3.5" />} title="链接（DEV-004 接入）" />
        <InfoRow label="入链"><span>{linkCounts.in}</span></InfoRow>
        <InfoRow label="出链"><span>{linkCounts.out}</span></InfoRow>
      </section>

      <section>
        <SectionHeader icon={<ListOrdered className="size-3.5" />} title="统计" />
        <InfoRow label="词数"><span>{stats.words}</span></InfoRow>
        <InfoRow label="块数"><span>{stats.blocks}</span></InfoRow>
      </section>

      <section>
        <SectionHeader icon={<Calendar className="size-3.5" />} title="时间" />
        <InfoRow label="创建时间"><span className="font-mono text-[11px] text-muted-foreground">{stats.created}</span></InfoRow>
        <InfoRow label="更新时间"><span className="font-mono text-[11px] text-muted-foreground">{stats.updated}</span></InfoRow>
      </section>

      <section>
        <SectionHeader icon={<FolderOpen className="size-3.5" />} title="操作" />
        <button
          type="button"
          onClick={showInFinder}
          className="rounded border px-2 py-1 text-[11px] hover:bg-accent"
        >
          在 Finder 中显示
        </button>
      </section>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
      <span className="text-muted-foreground">{icon}</span>
      <span>{title}</span>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{children}</span>
    </div>
  );
}

function FrontmatterValueDisplay({ value }: { value: FrontmatterValue }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (value instanceof Date) {
    return <span className="font-mono text-[11px]">{value.toISOString()}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap justify-end gap-1">
        {value.map((item) => (
          <span key={item} className="rounded-full border px-1.5 py-0.5 text-[10px]">{item}</span>
        ))}
      </span>
    );
  }
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>;
  return <span className="break-all">{String(value)}</span>;
}

function ConfidenceDisplay({ value }: { value: FrontmatterData['confidence'] | undefined }) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-center text-[11px] text-muted-foreground">
        置信度尚未计算（由 DEV-008 Git 底座提供）
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, value));
  const factors = [
    { name: 'Git 历史长度', weight: 0.3 },
    { name: '最近活跃度', weight: 0.3 },
    { name: '引用数量', weight: 0.25 },
    { name: '编辑稳定性', weight: 0.15 },
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{pct.toFixed(0)}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-0.5 text-[10px] text-muted-foreground">
        {factors.map((f) => (
          <li key={f.name} className="flex justify-between">
            <span>{f.name}</span>
            <span>{Math.round(f.weight * pct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
