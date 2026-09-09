import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    // @nexnote/shared 是 workspace 内部包（TS 源码导出），必须排除外部化、直接打进 bundle；
    // electron / electron-updater 等真实依赖保持外部化。
    plugins: [
      externalizeDepsPlugin({
        include: ['@napi-rs/keyring', 'dugite'],
        exclude: ['@nexnote/shared'],
      }),
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'packages/main/src/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@nexnote/shared'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'packages/main/src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'packages/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'packages/renderer/index.html') },
      },
    },
  },
});
