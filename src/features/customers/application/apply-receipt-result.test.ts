import { describe, it, expect } from 'vitest';
import { applyReceiptResult } from './apply-receipt-result';
import type { ReceiptFinancialStateInput, ReceiptFinancialEntry } from './apply-receipt-result';
import type { ApplyReceiptResult } from './receipt-submission-manager';
import type { LegacyCliente } from './merge-legacy-customers';

function makeState(): ReceiptFinancialStateInput {
  return {
    clientes: [
      { id: 'c1', nome: 'Ana', pendente: 50, contas: [{ saldo: 50 }], recebimentos: [] },
      { id: 'c2', nome: 'Bia', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] },
    ],
    entradas: [
      { desc: 'Rota 1', valor: 40, data: '22/09/2026', dateISO: '2026-09-22', clientName: 'Casa A' },
    ] as ReceiptFinancialEntry[],
  };
}

function makeResult(overrides: Partial<ApplyReceiptResult> = {}): ApplyReceiptResult {
  return {
    clientes: [
      { id: 'c1', nome: 'Ana', pendente: 20, contas: [{ saldo: 20 }], recebimentos: [{ receiptOperationId: 'receipt-xyz', valor: 30 }] },
    ] as LegacyCliente[],
    billingEntry: {
      receiptOperationId: 'receipt-xyz',
      source: 'client_receipt',
      clientId: 'c1',
      clientName: 'Ana',
      desc: 'Recebimento de Ana',
      valor: 30,
      data: '23/09/2026',
      dateISO: '2026-09-23',
      createdAt: 1,
      updatedAt: 2,
    },
    receiptOperationId: 'receipt-xyz',
    status: 'applied',
    ...overrides,
  };
}

describe('applyReceiptResult', () => {
  it('#1 applied insere a entrada nova no topo do faturamento', () => {
    const state = makeState();
    const output = applyReceiptResult(state, makeResult());

    expect(output.entradas).toHaveLength(2);
    expect(output.entradas[0]).toMatchObject({
      desc: 'Recebimento de Ana',
      valor: 30,
      data: '23/09/2026',
      dateISO: '2026-09-23',
      clientName: 'Ana',
      receiptOperationId: 'receipt-xyz',
    });
  });

  it('#2 already-applied com entrada existente atualiza sem duplicar', () => {
    const state: ReceiptFinancialStateInput = {
      clientes: makeState().clientes,
      entradas: [
        { desc: 'Antes', valor: 99, data: '01/01/2025', dateISO: '2025-01-01', clientName: 'Outra', receiptOperationId: 'receipt-xyz' },
        { desc: 'Rota 1', valor: 40, data: '22/09/2026', dateISO: '2026-09-22', clientName: 'Casa A' },
      ],
    };
    const output = applyReceiptResult(state, makeResult({ status: 'already-applied' }));

    expect(output.entradas).toHaveLength(2);
    expect(output.entradas[0]).toMatchObject({
      desc: 'Recebimento de Ana',
      valor: 30,
      receiptOperationId: 'receipt-xyz',
    });
  });

  it('#3 clientes do resultado são autoritativos, independente do estado local antigo', () => {
    const state = makeState();
    const result = makeResult();
    const output = applyReceiptResult(state, result);

    expect(output.clientes).toEqual(result.clientes);
    expect(output.clientes).not.toEqual(state.clientes);
  });

  it('#4 não muta os arrays recebidos (objetos congelados)', () => {
    const state = makeState();
    Object.freeze(state.clientes);
    Object.freeze(state.entradas);
    state.clientes.forEach((c) => Object.freeze(c));
    state.entradas.forEach((e) => Object.freeze(e));

    const output = applyReceiptResult(state, makeResult());

    expect(output.clientes[0].pendente).toBe(20);
    expect(state.entradas).toHaveLength(1);
    expect(state.clientes[0].pendente).toBe(50);
  });

  it('#5 valores monetários e identificadores são preservados exatamente', () => {
    const output = applyReceiptResult(makeState(), makeResult());

    expect(output.entradas[0].valor).toBe(30);
    expect(output.entradas[0].receiptOperationId).toBe('receipt-xyz');
    expect(output.clientes[0].recebimentos).toHaveLength(1);
  });

  it('#6 entradas já existentes fora do recebimento são mantidas intactas', () => {
    const output = applyReceiptResult(makeState(), makeResult());

    expect(output.entradas[1]).toEqual(makeState().entradas[0]);
  });
});