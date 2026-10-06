import { defineConfig } from 'vitest/config';

// Integração web contra Firestore Emulator; nunca roda no `npm run test`.
export default defineConfig({
  test: {
    include: ['src/**/*.emulator.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
