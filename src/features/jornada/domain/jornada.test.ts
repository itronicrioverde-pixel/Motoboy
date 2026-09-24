import { describe, it, expect } from 'vitest';
import { computeDistance, computeEstimatedCost } from './jornada';

describe('computeDistance — km percorridos entre oddômetros', () => {
  it('km final maior que o inicial', () => {
    expect(computeDistance(100, 145)).toBe(45);
  });

  it('km final igual ao inicial resulta zero', () => {
    expect(computeDistance(100, 100)).toBe(0);
  });

  it('km final menor que o inicial não é válido', () => {
    expect(computeDistance(145, 100)).toBeNull();
  });

  it('valores inválidos (NaN/Infinity) retornam null', () => {
    expect(computeDistance(NaN, 100)).toBeNull();
    expect(computeDistance(100, Infinity)).toBeNull();
  });
});

describe('computeEstimatedCost — custo estimado nunca é despesa', () => {
  it('calcula distância ÷ consumo × preço, arredondado em centavos', () => {
    expect(computeEstimatedCost(100, 145, 20, 6)).toBeCloseTo(13.5, 2);
    expect(computeEstimatedCost(0, 10, 10, 5)).toBe(5);
  });

  it('sem consumo ou sem preço de referência, o custo fica null', () => {
    expect(computeEstimatedCost(100, 145, null, 6)).toBeNull();
    expect(computeEstimatedCost(100, 145, 20, null)).toBeNull();
    expect(computeEstimatedCost(100, 145, 0, 6)).toBeNull();
    expect(computeEstimatedCost(100, 145, 20, 0)).toBeNull();
  });

  it('km final menor que o inicial anula o custo', () => {
    expect(computeEstimatedCost(145, 100, 20, 6)).toBeNull();
  });
});