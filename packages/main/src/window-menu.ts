import type { MenuAction, UiLanguage } from '@nexnote/shared';
import { CATALOGS, translate } from '@nexnote/shared';

/**
 * 原生应用菜单模板保持纯函数：语言与动作只作为参数进入，便于在 Electron
 * 运行时之外测试本地化结果与 IPC 下发动作。
 */
export function buildApplicationMenuTemplate(
  language: UiLanguage,
  send: (action: MenuAction) => void,
): Electron.MenuItemConstructorOptions[] {
  const catalog = CATALOGS[language];
  const t = (key: string): string => translate(catalog, key, language);
  return [
    {
      label: t('app.menu.file'),
      submenu: [
        {
          label: t('app.menu.file.newBlockNote'),
          accelerator: 'CmdOrCtrl+N',
          click: () => send({ type: 'createNote', format: 'native-block' }),
        },
        {
          label: t('app.menu.file.newMarkdown'),
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send({ type: 'createNote', format: 'markdown' }),
        },
        { type: 'separator' },
        {
          label: t('app.menu.file.newXlsx'),
          click: () => send({ type: 'createBlankBinary', kind: 'xlsx' }),
        },
        {
          label: t('app.menu.file.newXmind'),
          click: () => send({ type: 'createBlankBinary', kind: 'xmind' }),
        },
        { type: 'separator' },
        {
          label: t('app.menu.file.importDocx'),
          click: () => send({ type: 'importDocx' }),
        },
        {
          label: t('app.menu.file.importXlsx'),
          click: () => send({ type: 'importXlsx' }),
        },
        {
          label: t('app.menu.file.importXmind'),
          click: () => send({ type: 'importXmind' }),
        },
      ],
    },
    {
      label: t('app.menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: t('app.menu.view'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}
