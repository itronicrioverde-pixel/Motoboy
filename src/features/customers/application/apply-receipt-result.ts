/**
 * Aplicação do resultado de um recebimento no estado local do painel.
 *
 * Função pura: não toca DOM, window, localStorage nem muta os arrays recebidos.
 * Devolve cópias novas. A entrada de faturamento é sincronizada por
 * receiptOperationId (upsert), então "applied" e "already-applied" nunca duplicam.
 */

import type { LegacyCliente } from './merge-legacy-customers';
import type { ApplyReceiptResult } from './receipt-submission-manager';

export interface ReceiptFinancialStateInput {
  readonly clientes: LegacyCliente[];
  readonly entradas: readonly ReceiptFinancialEntry[];
}

export interface ReceiptFinancialEntry {
  readonly desc?: string;
  readonly valor?: number;
  readonly data?: string;
  readonly dateISO?: string;
  readonly clientName?: string;
  readonly receiptOperationId?: string;
  [key: string]: unknown;
}

export interface ReceiptFinancialStateOutput {
  readonly clientes: LegacyCliente[];
  readonly entradas: ReceiptFinancialEntry[];
}

/**
 * Combina o estado financeiro local com o resultado autoritativo do gateway.
 * - `clientes` vem da projeção financeira do Firestore (autoritativa).
 * - `entradas` recebe/atualiza a entrada com o mesmo receiptOperationId.
 */
export function applyReceiptResult(
  state: ReceiptFinancialStateInput,
  result: ApplyReceiptResult,
): ReceiptFinancialStateOutput {
  const { billingEntry, receiptOperationId } = result;

  const entry: ReceiptFinancialEntry = {
    desc: billingEntry.desc,
    valor: billingEntry.valor,
    data: billingEntry.data,
    dateISO: billingEntry.dateISO,
    clientName: billingEntry.clientName,
    receiptOperationId,
  };

  const nextEntradas = state.entradas.map((e) => ({ ...e }));
  const existingIdx = nextEntradas.findIndex((e) => e.receiptOperationId === receiptOperationId);
  if (existingIdx >= 0) {
    nextEntradas[existingIdx] = { ...nextEntradas[existingIdx], ...entry };
  } else {
    nextEntradas.unshift(entry);
  }

  return {
    // O resultado do Gateway é a fonte de verdade para o saldo e o histórico do cliente.
    clientes: result.clientes.map((cliente) => ({ ...cliente })),
    entradas: nextEntradas,
  };
}