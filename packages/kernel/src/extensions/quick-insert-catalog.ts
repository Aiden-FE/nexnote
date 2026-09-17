import { findWrapping } from '@tiptap/pm/transform';
import { editorActionCatalogEntry, quickInsertCatalog } from '@nexnote/shared';
import type { QuickInsertItem } from './quick-insert';
import { insertAtSafeBlockBoundary } from './slash-contract';

function item(id: string, action: QuickInsertItem['action']): QuickInsertItem {
  const definition = editorActionCatalogEntry(id);
  const quick = definition?.quickInsert;
  if (!definition || !quick) throw new Error(`Unknown quick insert action: ${id}`);
  return {
    id,
    title: definition.name,
    icon: definition.icon,
    aliases: [...quick.aliases],
    keywords: [...quick.aliases],
    group: quick.group,
    kind: quick.kind,
    contract: { execution: quick.execution, capability: quick.capability },
    action,
  };
}

export function defaultQuickInsertItems(): QuickInsertItem[] {
  const handlers = new Map<string, QuickInsertItem['action']>();
  handlers.set('block:paragraph', ({ view }) => {
    const type = view.state.schema.nodes.paragraph;
    if (!type) return false;
    view.dispatch(
      view.state.tr.setBlockType(view.state.selection.from, view.state.selection.to, type),
    );
    return true;
  });
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    handlers.set(`block:heading:${level}`, ({ view }) => {
      const type = view.state.schema.nodes.heading;
      if (!type) return false;
      view.dispatch(
        view.state.tr
          .setBlockType(view.state.selection.from, view.state.selection.to, type, { level })
          .scrollIntoView(),
      );
      return true;
    });
  }
  const list = (name: 'bulletList' | 'orderedList' | 'taskList') =>
    handlers.set(
      `block:${name === 'bulletList' ? 'bullet-list' : name === 'orderedList' ? 'ordered-list' : 'task-list'}`,
      ({ view }) => {
        const listType = view.state.schema.nodes[name];
        const itemType = view.state.schema.nodes[name === 'taskList' ? 'taskItem' : 'listItem'];
        const paragraph = view.state.schema.nodes.paragraph;
        if (!listType || !itemType || !paragraph) return false;
        const $from = view.state.selection.$from;
        view.dispatch(
          view.state.tr.replaceWith(
            $from.before($from.depth),
            $from.after($from.depth),
            listType.create(null, itemType.create(null, paragraph.create())),
          ),
        );
        return true;
      },
    );
  list('bulletList');
  list('orderedList');
  list('taskList');
  handlers.set('block:blockquote', ({ view }) => {
    const range = view.state.selection.$from.blockRange(view.state.selection.$to);
    const wrapping = range ? findWrapping(range, view.state.schema.nodes.blockquote!) : null;
    if (!range || !wrapping) return false;
    view.dispatch(view.state.tr.wrap(range, wrapping).scrollIntoView());
    return true;
  });
  handlers.set('block:code', ({ view }) => {
    const type = view.state.schema.nodes.codeBlock;
    if (!type) return false;
    view.dispatch(
      view.state.tr
        .setBlockType(view.state.selection.from, view.state.selection.to, type, {
          language: 'plaintext',
        })
        .scrollIntoView(),
    );
    return true;
  });
  handlers.set('insert:horizontal-rule', ({ view }) => {
    const type = view.state.schema.nodes.horizontalRule;
    return type ? insertAtSafeBlockBoundary(view, type.create()) : false;
  });
  handlers.set('insert:table', ({ view }) => {
    const { table, tableRow, tableHeader, tableCell, paragraph } = view.state.schema.nodes;
    if (!table || !tableRow || !tableHeader || !tableCell || !paragraph) return false;
    const row = (cell: typeof tableHeader) =>
      tableRow.create(null, [
        cell.create(null, paragraph.create()),
        cell.create(null, paragraph.create()),
      ]);
    return insertAtSafeBlockBoundary(view, table.create(null, [row(tableHeader), row(tableCell)]));
  });
  handlers.set('insert:toc', ({ view }) => {
    const type = view.state.schema.nodes.tableOfContents;
    return type ? insertAtSafeBlockBoundary(view, type.create()) : false;
  });
  handlers.set('format:wikilink', ({ view }) => {
    view.dispatch(view.state.tr.insertText('[[').scrollIntoView());
    return true;
  });
  return quickInsertCatalog('block').flatMap((definition) => {
    const handler = handlers.get(definition.id);
    return handler ? [item(definition.id, handler)] : [];
  });
}
