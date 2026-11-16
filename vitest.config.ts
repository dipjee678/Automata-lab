import { defineConfig } from 'vitest/config';

// Unit + integration tests for the algorithm library and the backend API.
// (Playwright end-to-end tests live in ./e2e and run with `npm run test:e2e`.)
export default defineConfig({
  test: {
    include: ['algorithms/tests/**/*.test.ts', 'backend/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
