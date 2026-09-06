import { defineConfig } from 'vitest/config';

// Suíte de integração no Firestore Emulator. Rodar via:
//   firebase emulators:exec --only firestore --project demo-motoboy \
//     "npm --prefix functions run test:emulator"
// (o emulators:exec define FIRESTORE_EMULATOR_HOST e GCLOUD_PROJECT=demo-*).
export default defineConfig({
  test: {
    include: ['src/**/*.emulator.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
