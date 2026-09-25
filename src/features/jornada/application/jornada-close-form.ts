/**
 * Regras do formulário de ENCERRAMENTO de jornada no painel.
 *
 * O objetivo do fluxo é estimar o combustível, então o CONSUMO (km/L) é
 * obrigatório para encerrar: vale o digitado pelo motoboy (origem `moto`) ou,
 * na falta dele, o consumo vigente da moto (`historico` quando vem dos
 * abastecimentos; `moto` quando ajustado à mão). Um valor digitado inválido
 * NÃO usa o fallback: bloqueia com aviso.
 *
 * O PREÇO continua opcional (digitar, ou o último preço vigente — origem
 * `abastecimento`); sem preço, só o custo estimado fica de fora da jornada.
 *
 * Módulo puro (sem Firebase, DOM ou localStorage) e testável em runtime.
 */

import type { ConsumoOrigem, PrecoOrigem } from '../domain/jornada';

export interface JornadaCloseInputs {
  kmInicial: number;
  kmFinal: number;
  consumptionInput: number | null;
  priceInput: number | null;
}

export interface JornadaCloseDefaults {
  consumoAtual: number;
  consumoManual: boolean;
  consumoReal: number | null;
  precoAtual: number;
}

export type JornadaCloseResolution =
  | {
      ok: true;
      error: null;
      kmFinal: number;
      consumoReferencia: number;
      origemConsumo: ConsumoOrigem;
      precoReferencia: number | null;
      origemPreco: PrecoOrigem | null;
    }
  | {
      ok: false;
      error: string;
      kmFinal: null;
      consumoReferencia: null;
      origemConsumo: null;
      precoReferencia: null;
      origemPreco: null;
    };

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function isInvalidTypedValue(value: number | null): boolean {
  return value !== null && !isPositive(value);
}

export function resolveJornadaCloseReferences(
  inputs: JornadaCloseInputs,
  defaults: JornadaCloseDefaults,
): JornadaCloseResolution {
  if (!Number.isFinite(inputs.kmFinal) || inputs.kmFinal < inputs.kmInicial) {
    return {
      ok: false,
      error: 'Informe um km final válido para a jornada.',
      kmFinal: null,
      consumoReferencia: null,
      origemConsumo: null,
      precoReferencia: null,
      origemPreco: null,
    };
  }

  let consumoReferencia: number;
  let origemConsumo: ConsumoOrigem;
  if (isPositive(inputs.consumptionInput)) {
    consumoReferencia = inputs.consumptionInput;
    origemConsumo = 'moto';
  } else if (isInvalidTypedValue(inputs.consumptionInput)) {
    return {
      ok: false,
      error: 'Informe um consumo válido (maior que zero).',
      kmFinal: null,
      consumoReferencia: null,
      origemConsumo: null,
      precoReferencia: null,
      origemPreco: null,
    };
  } else if (defaults.consumoAtual > 0) {
    consumoReferencia = defaults.consumoAtual;
    origemConsumo =
      defaults.consumoManual || !(defaults.consumoReal && defaults.consumoReal > 0)
        ? 'moto'
        : 'historico';
  } else {
    return {
      ok: false,
      error: 'Para encerrar, informe o consumo médio (km/L) da moto.',
      kmFinal: null,
      consumoReferencia: null,
      origemConsumo: null,
      precoReferencia: null,
      origemPreco: null,
    };
  }

  let precoReferencia: number | null;
  if (isPositive(inputs.priceInput)) {
    precoReferencia = inputs.priceInput;
  } else if (defaults.precoAtual > 0) {
    precoReferencia = defaults.precoAtual;
  } else {
    precoReferencia = null;
  }
  const origemPreco: PrecoOrigem | null = precoReferencia !== null ? 'abastecimento' : null;

  return {
    ok: true,
    error: null,
    kmFinal: inputs.kmFinal,
    consumoReferencia,
    origemConsumo,
    precoReferencia,
    origemPreco,
  };
}