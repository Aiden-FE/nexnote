import { defineConfig } from 'vitest/config';

// 跨端核对专用配置：只跑本目录下的核对脚本
export default defineConfig({
  test: {
    include: ['.scratch/nexnote-mobile/verify/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
