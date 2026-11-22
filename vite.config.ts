import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/cutprep/',
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
