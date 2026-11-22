import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/cutprep/',
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
