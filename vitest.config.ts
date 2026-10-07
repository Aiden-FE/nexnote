import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/main/tests/**/*.test.ts',
      'packages/shared/src/**/*.test.ts',
      'packages/kernel/tests/**/*.test.ts',
      'packages/renderer/tests/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    // @tiptap/extension-drag-handle 经 collaboration/lib0 在 worker 导入期探测
    // localStorage；给 Node 26 显式提供文件可避免 ExperimentalWarning。
    execArgv: ['--localstorage-file=node_modules/.cache/nexnote-vitest-localstorage'],
    testTimeout: 20_000,
  },
});
