import { defineConfig, configDefaults } from 'vitest/config';

// A suíte da raiz cobre apenas o app web em `src/`. As Functions têm build,
// deps e suíte próprios em `functions/` (isolamento — DEC-019). Excluí-las aqui
// mantém a baseline do web estável e evita execução duplicada dos testes server.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'functions/**', 'src/**/*.emulator.test.ts'],
  },
});
