import { describe, it, expect } from 'vitest';
import { resolveJornadaCloseReferences } from './jornada-close-form';

/** Sem consumo vigente nem preço: o fluxo deve bloquear o encerramento. */
const EMPTY_DEFAULTS = { consumoAtual: 0, consumoManual: false, consumoReal: null, precoAtual: 0 };

describe('resolveJornadaCloseReferences — sem consumo não encerra', () => {
  it('rejeita quando não há consumo digitado nem consumo vigente', () => {
    const result = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 200, consumptionInput: null, priceInput: null },
      EMPTY_DEFAULTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('consumo médio');
      expect(result.consumoReferencia).toBeNull();
      expect(result.origemConsumo).toBeNull();
    }
  });

  it('rejeita km final inválido ou menor que o inicial antes de qualquer referência', () => {
    const noKMFinal = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: NaN, consumptionInput: 25, priceInput: 6 },
      EMPTY_DEFAULTS,
    );
    expect(noKMFinal.ok).toBe(false);
    const kmMenor = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 99, consumptionInput: 25, priceInput: 6 },
      EMPTY_DEFAULTS,
    );
    expect(kmMenor.ok).toBe(false);
  });

  it('aceita consumo digitado pelo motoboy com origem "moto"', () => {
    const result = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 200, consumptionInput: 20, priceInput: 6.1 },
      EMPTY_DEFAULTS,
    );
    expect(result).toMatchObject({
      ok: true,
      kmFinal: 200,
      consumoReferencia: 20,
      origemConsumo: 'moto',
      precoReferencia: 6.1,
      origemPreco: 'abastecimento',
    });
  });

  it('consumo digitado inválido (zero/negativo) bloqueia sem usar o fallback', () => {
    const invalid = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 200, consumptionInput: 0, priceInput: null },
      { consumoAtual: 25, consumoManual: false, consumoReal: 24, precoAtual: 6 },
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toContain('maior que zero');
  });

  it('sem consumo digitado usa o consumo vigente; do histórico vem "historico"', () => {
    const result = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 200, consumptionInput: null, priceInput: null },
      { consumoAtual: 24, consumoManual: false, consumoReal: 24, precoAtual: 6 },
    );
    expect(result).toMatchObject({ ok: true, consumoReferencia: 24, origemConsumo: 'historico', precoReferencia: 6 });
  });

  it('consumo ajustado à mão em Minha Moto mantém origem "moto"', () => {
    const result = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 200, consumptionInput: null, priceInput: null },
      { consumoAtual: 30, consumoManual: true, consumoReal: 24, precoAtual: 6 },
    );
    expect(result).toMatchObject({ ok: true, consumoReferencia: 30, origemConsumo: 'moto' });
  });

  it('preço fica opcional: sem preço digitado nem vigente, somente o custo some', () => {
    const result = resolveJornadaCloseReferences(
      { kmInicial: 100, kmFinal: 200, consumptionInput: 20, priceInput: null },
      { consumoAtual: 0, consumoManual: false, consumoReal: null, precoAtual: 0 },
    );
    expect(result).toMatchObject({ ok: true, consumoReferencia: 20, precoReferencia: null, origemPreco: null });
  });
});