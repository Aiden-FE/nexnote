import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/main/tests/**/*.test.ts', 'packages/kernel/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
