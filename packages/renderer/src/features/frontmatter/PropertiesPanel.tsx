import { useMemo } from 'react';
import { FileText, Gauge, Link2, ListOrdered, Calendar, FolderOpen, Braces } from 'lucide-react';
import type { ConfidenceResult } from '@nexnote/shared';
import type { FrontmatterData } from '@nexnote/kernel';
import {
  formatDisplayDateTime,
  getList,
  getString,
  isStandardField,
  type FrontmatterValue,
} from '@nexnote/kernel';
import { invoke } from '../../lib/ipc';
import { t, useI18n } from '../../lib/i18n';
import { pageStatistics } from './frontmatter-utils';

export interface PropertiesPanelProps {
  markdown: string;
  data: FrontmatterData;
  filePath: string;
  /** 入链 / 出链数量（由 DEV-004 Link Index 实时提供）。 */
  linkCounts?: { in: number; out: number };
  confidence?: ConfidenceResult | null;
  /** DEV-080：当前文档派生 format，用于「类型」行展示（替代被移除的 frontmatter.type）。 */
  format?: string | null;
}

/** DEV-080：DocumentFormat → 用户可读标签的映射，集中一处便于扩展。 */
const FORMAT_KEY: Record<string, string> = {
  'native-block': 'frontmatter.format.native-block',
  markdown: 'frontmatter.format.markdown',
  docx: 'frontmatter.format.docx',
  xlsx: 'frontmatter.format.xlsx',
  mindmap: 'frontmatter.format.mindmap',
};

function formatLabel(format: string | null | undefined): string {
  return t(FORMAT_KEY[format ?? ''] ?? 'frontmatter.format.ordinary');
}

/** 右侧「文档属性」面板。 */
export function PropertiesPanel({
  markdown,
  data,
  filePath,
  linkCounts = { in: 0, out: 0 },
  confidence = null,
  format = null,
}: PropertiesPanelProps) {
  const tr = useI18n();
  const stats = useMemo(() => pageStatistics(markdown), [markdown]);
  const tags = getList(data, 'tags');
  const aliases = getList(data, 'aliases');
  const customFields = Object.entries(data)
    .filter(([key]) => !isStandardField(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const showInFinder = () => {
    void invoke('vault:reveal', { path: filePath });
  };

  return (
    <div data-testid="properties-panel" className="space-y-4 text-xs">
      <section>
        <SectionHeader icon={<FileText className="size-3.5" />} title={tr('frontmatter.basicInformation')} />
        <InfoRow label={tr('frontmatter.filePath')}>
          <button
            type="button"
            onClick={showInFinder}
            className="max-w-full truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title={tr('frontmatter.showInFinderTitle', { path: filePath })}
          >
            {filePath}
          </button>
        </InfoRow>
        <InfoRow label={tr('frontmatter.title')}>
          <span className="truncate">
            {getString(data, 'title') || tr('frontmatter.unset')}
          </span>
        </InfoRow>
        <InfoRow label={tr('frontmatter.type')}>
          <span className="truncate">{formatLabel(format)}</span>
        </InfoRow>
        <InfoRow label={tr('frontmatter.aliases')}>
          {aliases.length === 0 ? (
            <span className="text-muted-foreground">{tr('frontmatter.none')}</span>
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
        <InfoRow label={tr('frontmatter.tags')}>
          {tags.length === 0 ? (
            <span className="text-muted-foreground">{tr('frontmatter.none')}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </InfoRow>
      </section>

      <section>
        <SectionHeader icon={<Braces className="size-3.5" />} title={tr('frontmatter.customFields')} />
        {customFields.length === 0 ? (
          <p className="py-1 text-[11px] text-muted-foreground">
            {tr('frontmatter.noCustomFields')}
          </p>
        ) : (
          customFields.map(([key, value]) => (
            <InfoRow key={key} label={key}>
              <FrontmatterValueDisplay value={value} />
            </InfoRow>
          ))
        )}
      </section>

      <section>
        <SectionHeader icon={<Gauge className="size-3.5" />} title={tr('frontmatter.confidence')} />
        <ConfidenceDisplay value={confidence} />
      </section>

      <section>
        <SectionHeader icon={<Link2 className="size-3.5" />} title={tr('frontmatter.link')} />
        <InfoRow label={tr('frontmatter.inboundLinks')}>
          <span>{linkCounts.in}</span>
        </InfoRow>
        <InfoRow label={tr('frontmatter.outboundLinks')}>
          <span>{linkCounts.out}</span>
        </InfoRow>
      </section>

      <section>
        <SectionHeader icon={<ListOrdered className="size-3.5" />} title={tr('frontmatter.statistics')} />
        <InfoRow label={tr('frontmatter.words')}>
          <span>{stats.words}</span>
        </InfoRow>
        <InfoRow label={tr('frontmatter.blocks')}>
          <span>{stats.blocks}</span>
        </InfoRow>
      </section>

      <section>
        <SectionHeader icon={<Calendar className="size-3.5" />} title={tr('frontmatter.time')} />
        <InfoRow label={tr('frontmatter.createdAt')}>
          <span className="font-mono text-[11px] text-muted-foreground">{stats.created}</span>
        </InfoRow>
        <InfoRow label={tr('frontmatter.updatedAt')}>
          <span className="font-mono text-[11px] text-muted-foreground">{stats.updated}</span>
        </InfoRow>
      </section>

      <section>
        <SectionHeader icon={<FolderOpen className="size-3.5" />} title={tr('frontmatter.actions')} />
        <button
          type="button"
          onClick={showInFinder}
          className="rounded border px-2 py-1 text-[11px] hover:bg-accent"
        >
          {tr('frontmatter.showInFinder')}
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
    // DEV-078：展示本地时区可读时间，存储仍为 ISO
    return <span className="font-mono text-[11px]">{formatDisplayDateTime(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap justify-end gap-1">
        {value.map((item) => (
          <span key={item} className="rounded-full border px-1.5 py-0.5 text-[10px]">
            {item}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === 'boolean') return <span>{value ? 'true' : 'false'}</span>;
  return <span className="break-all">{String(value)}</span>;
}

function ConfidenceDisplay({ value }: { value: ConfidenceResult | null }) {
  if (!value) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-center text-[11px] text-muted-foreground">
        {t('frontmatter.confidenceNotComputed')}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{value.score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(0, Math.min(100, value.score))}%` }}
        />
      </div>
      <ul className="space-y-1.5">
        {value.factors.map((item) => (
          <li
            key={item.key}
            title={t('frontmatter.confidenceFactorTitle', {
              label: item.label,
              detail: item.detail,
            })}
            data-testid={`confidence-factor-${item.key}`}
          >
            <div className="flex justify-between">
              <span className="text-[10px] text-muted-foreground">{item.label}</span>
              <span className="text-[10px]">{item.contribution.toFixed(1)}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-secondary"
                style={{ width: `${item.score * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
