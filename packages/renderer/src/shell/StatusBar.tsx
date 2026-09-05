import { useRegistryItems, statusBarRegistry } from '../registries';

/**
 * 底部状态栏：条目插槽（注册表驱动）。
 * DEV-007（Git 分支/变更/pull-push）通过注册状态项接入，本组件不改。
 */
export function StatusBar() {
  const items = useRegistryItems(statusBarRegistry);
  const left = items.filter((i) => i.align === 'left');
  const right = items.filter((i) => i.align === 'right');

  return (
    <footer
      data-testid="status-bar"
      className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/40 px-2.5 text-xs text-muted-foreground"
    >
      {left.map((item) => {
        const Content = item.render;
        return <Content key={item.id} />;
      })}
      <div className="ml-auto flex items-center gap-3">
        {right.map((item) => {
          const Content = item.render;
          return <Content key={item.id} />;
        })}
      </div>
    </footer>
  );
}
