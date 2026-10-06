import { describe, expect, it } from 'vitest';
import { currentPeriodLabel } from './current-period';

describe('currentPeriodLabel', () => {
  it('mostra o mês e a semana local de 28 de setembro de 2026', () => {
    expect(currentPeriodLabel(new Date(2026, 8, 28))).toEqual({
      monthYear: 'SET 2026',
      week: 'semana 5',
    });
  });

  it('atualiza o rótulo na virada de mês e ano', () => {
    expect(currentPeriodLabel(new Date(2026, 11, 31))).toEqual({
      monthYear: 'DEZ 2026',
      week: 'semana 5',
    });
    expect(currentPeriodLabel(new Date(2027, 0, 1))).toEqual({
      monthYear: 'JAN 2027',
      week: 'semana 1',
    });
  });
});
