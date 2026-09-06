import { SlidersHorizontal } from 'lucide-react';
import { dockPanelRegistry } from '../../registries';
import { PropertiesPanel } from './PropertiesPanel';
import { useDocumentPropertiesStore } from './document-properties-store';
import { useLinkCounts } from './use-link-counts';

/** DEV-005：右侧 Dock 的文档属性页签。 */
dockPanelRegistry.register({
  id: 'document-properties',
  title: '属性',
  icon: SlidersHorizontal,
  render: DocumentPropertiesDockPanel,
});

function DocumentPropertiesDockPanel() {
  const filePath = useDocumentPropertiesStore((s) => s.filePath);
  const markdown = useDocumentPropertiesStore((s) => s.markdown);
  const data = useDocumentPropertiesStore((s) => s.data);
  const linkCounts = useLinkCounts(filePath);

  if (!filePath) {
    return (
      <div
        data-testid="properties-panel-empty"
        className="flex h-full items-center justify-center text-center text-xs text-muted-foreground"
      >
        打开一个 Markdown 页面以查看文档属性
      </div>
    );
  }

  return <PropertiesPanel markdown={markdown} data={data} filePath={filePath} linkCounts={linkCounts} />;
}
