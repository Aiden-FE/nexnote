import { KERNEL_VERSION } from '@nexnote/kernel';

/** 页面 Tab 占位内容：DEV-002 的编辑器内核将替换此组件。 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="nexnote-editor-scope mx-auto flex h-full max-w-3xl flex-col px-8 py-10">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-8 text-xs text-muted-foreground">占位页面 · 编辑器内核 {KERNEL_VERSION}</p>

      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <p className="mb-2 text-foreground">此区域将由 DEV-002 的 TipTap 3 编辑器内核渲染。</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed">
          <li>Markdown ↔ 块模型双向管道（Obsidian 方言：wikilink / ^id / callout / frontmatter）</li>
          <li>块稳定 ID（^id 锚点）与 DragHandle 拖拽</li>
          <li>斜杠命令菜单与保存防抖</li>
        </ul>
      </div>

      <div className="mt-6 space-y-2 text-sm leading-[1.75] text-muted-foreground/80">
        <p>这是一段占位正文，用于预览编辑器内容区的字体、行高与最大宽度（编辑器桥接 CSS 变量）。</p>
        <p>
          主题系统通过 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">--editor-*</code>{' '}
          变量桥接 shadcn/ui 与未来的 TipTap 样式；切换主题时此处观感会同步变化。
        </p>
      </div>
    </div>
  );
}
