import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['__tests__/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/', '.next/', 'BDM-AI-starter/'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: ['node_modules/', '.next/', '**/*.test.ts', '**/*.test.tsx', '**/*.d.ts', 'next-env.d.ts'],
    },
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
  },
});