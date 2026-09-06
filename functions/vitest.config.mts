import { defineConfig, configDefaults } from 'vitest/config';

// Suíte padrão das Functions: exclui os testes de Emulator (exigem Java + o
// Firestore Emulator). Assim `npm run check` continua verde sem o Emulator.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.emulator.test.ts'],
  },
});
