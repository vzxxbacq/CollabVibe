import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/admin-ui/tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'test/**'],
    setupFiles: ['packages/admin-ui/tests/setup.ts']
  }
});
