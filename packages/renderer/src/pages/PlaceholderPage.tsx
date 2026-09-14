/** 暂不支持直接编辑的文档格式提示。 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="nexnote-editor-scope mx-auto flex h-full max-w-3xl flex-col px-8 py-10">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-8 text-xs text-muted-foreground">此文档格式暂不支持直接编辑</p>

      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <p className="text-foreground">此文档格式暂不支持直接编辑或预览。</p>
      </div>
    </div>
  );
}
