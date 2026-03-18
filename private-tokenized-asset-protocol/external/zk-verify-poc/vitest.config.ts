import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['poc/tests/**/*.spec.ts', 'mock-server/tests/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text']
    }
  }
});
