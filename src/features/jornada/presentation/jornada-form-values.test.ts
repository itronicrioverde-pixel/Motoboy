import { describe, expect, it } from 'vitest';
import { parseJornadaFormValue } from './jornada-form-values';

describe('leitura dos campos numéricos da jornada', () => {
  it('aceita o hodômetro com milhar e valores decimais em português', () => {
    expect(parseJornadaFormValue('44.000')).toBe(44000);
    expect(parseJornadaFormValue('44.125,5')).toBe(44125.5);
    expect(parseJornadaFormValue('25,5')).toBe(25.5);
    expect(parseJornadaFormValue('6.05')).toBe(6.05);
  });

  it('distingue campo vazio de texto inválido para impedir fallback silencioso', () => {
    expect(parseJornadaFormValue('  ')).toBeNull();
    expect(parseJornadaFormValue('1,2,3')).toBeNaN();
    expect(parseJornadaFormValue('abc')).toBeNaN();
    expect(parseJornadaFormValue('-')).toBeNaN();
    expect(parseJornadaFormValue('0')).toBe(0);
  });
});