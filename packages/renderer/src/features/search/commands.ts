
import { commandRegistry } from '../../registries';
import { useUiStore } from '../../stores/ui-store';
import { useIndexStore } from '../../stores/index-store';

commandRegistry.register({
  id: 'search.open',
  title: '全文搜索',
  category: '搜索',
  keywords: ['search', 'fts', '全文', '搜索'],
  shortcut: '⌘⇧F',
  run: () => useUiStore.getState().setSearchOpen(true),
});


commandRegistry.register({
  id: 'index.rebuild',
  title: '重建关系索引',
  category: '搜索',
  keywords: ['index', 'rebuild', '索引', '重建'],
  run: () => useIndexStore.getState().rebuild(),
});
