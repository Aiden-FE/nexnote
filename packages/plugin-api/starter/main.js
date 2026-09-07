/* global window */
/* 全局 nexnotePlugin 由宿主注入；类型见 @nexnote/plugin-api。 */
window.addEventListener('nexnote-plugin-initialize', () => {
  // 一次性初始化（此时 window.nexnotePlugin 已就绪）。
});

window.addEventListener('nexnote-plugin-activate', () => {
  // manifest 中声明的命令/视图/菜单/块会自动出现在宿主；
  // 运行时也可再注册命令：
  window.nexnotePlugin.registerCommand(
    'runtime-hello',
    '示例：运行时打招呼',
    ['runtime'],
  );
});

window.addEventListener('nexnote-plugin-ready', () => {
  // 宿主完成握手后的入口；视图/块 UI 在此挂载。
});
