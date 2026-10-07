import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * chokidar 5 的运行时入口只把 `Stats` 当类型使用，却以 value import 形式导入。
 * 桌面主进程 bundle 的 external `node:fs` 因此触发 Rollup UNUSED_IMPORT 告警；
 * 上游修正前，这里仅在构建期移除这个未用绑定。
 */
function fixChokidarStatsImport(): Plugin {
  return {
    name: 'nexnote/fix-chokidar-stats-import',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/node_modules/.pnpm/chokidar@')) return null;
      return code.replace(
        "import { stat as statcb, Stats } from 'node:fs';",
        "import { stat as statcb } from 'node:fs';",
      );
    },
  };
}

const ignoreZodInvalidAnnotation = (
  warning: { code?: string; id?: string },
  warn: (warning: unknown) => void,
): void => {
  if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/.pnpm/zod@')) {
    return;
  }
  warn(warning);
};

export default defineConfig({
  main: {
    // @nexnote/shared 是 workspace 内部包（TS 源码导出），必须排除外部化、直接打进 bundle；
    // electron / electron-updater 等真实依赖保持外部化。
    plugins: [
      externalizeDepsPlugin({
        include: ['@napi-rs/keyring', 'dugite'],
        exclude: ['@nexnote/shared'],
      }),
      fixChokidarStatsImport(),
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'packages/main/src/index.ts') },
        onwarn: ignoreZodInvalidAnnotation,
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
        input: {
          index: resolve(root, 'packages/renderer/index.html'),
          // DEV-074 二进制编辑器宿主（docx/xlsx/mindmap 各一个独立 WebContentsView）。
          'editor-host': resolve(root, 'packages/renderer/editor-host.html'),
        },
      },
    },
  },
});
