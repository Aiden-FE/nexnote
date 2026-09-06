/* global window */
window.addEventListener('nexnote-plugin-ready', () => {
  window.nexnotePlugin.registerCommand('runtime-hello', 'Demo: Runtime Hello', ['runtime']);
});
window.addEventListener('nexnote-plugin-initialize', () => {
  window.__demoLifecycle = ['initialize'];
});
window.addEventListener('nexnote-plugin-activate', () => window.__demoLifecycle.push('activate'));
window.addEventListener('nexnote-plugin-deactivate', () =>
  window.__demoLifecycle.push('deactivate'),
);
window.addEventListener('nexnote-plugin-unload', () => window.__demoLifecycle.push('unload'));
