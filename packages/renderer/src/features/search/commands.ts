
import { commandRegistry } from '../../registries';
import { useUiStore } from '../../stores/ui-store';
import { useIndexStore } from '../../stores/index-store';

commandRegistry.register({
  id: 'search.open',
  title: 'command.search.open',
  category: 'command.category.search',
  keywords: ['search', 'fts', 'full text', '全文', '搜索'],
  shortcut: '⌘⇧F',
  run: () => useUiStore.getState().setSearchOpen(true),
});


commandRegistry.register({
  id: 'index.rebuild',
  title: 'command.index.rebuild',
  category: 'command.category.search',
  keywords: ['index', 'rebuild', 'relation index', '索引', '重建'],
  run: () => useIndexStore.getState().rebuild(),
});
