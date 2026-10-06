import { describe, expect, it } from 'vitest';
import { monthlyRefuelTotal } from './monthly-refuel-total';

describe('monthlyRefuelTotal', () => {
  it('não inclui abastecimentos de meses anteriores no cartão mensal', () => {
    expect(monthlyRefuelTotal([
      { dateISO: '2026-08-30', valor: 130 },
      { dateISO: '2026-07-31', valor: 120 },
    ], '2026-09')).toBe(0);
  });

  it('soma só o mês corrente e ignora registro sem data atribuível', () => {
    expect(monthlyRefuelTotal([
      { dateISO: '2026-09-01', valor: 100 },
      { dateISO: '2026-09-28', valor: 25.5 },
      { dateISO: '2026-08-31', valor: 50 },
      { valor: 200 },
    ], '2026-09')).toBe(125.5);
  });
});
