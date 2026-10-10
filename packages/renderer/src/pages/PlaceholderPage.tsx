/** 暂不支持直接编辑的文档格式提示。 */
import { useI18n } from '../lib/i18n';

export function PlaceholderPage({ title }: { title: string }) {
  const t = useI18n();
  return (
    <div className="nexnote-editor-scope mx-auto flex h-full max-w-3xl flex-col px-8 py-10">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-8 text-xs text-muted-foreground">{t('placeholder.subtitle')}</p>

      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <p className="text-foreground">{t('placeholder.body')}</p>
      </div>
    </div>
  );
}
