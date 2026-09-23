import { describe, it, expect } from 'vitest';
import { entradaToEntryVM, dateLabelForISO } from './entrada-view-model';
import { applyReceiptResult } from '../../customers/application/apply-receipt-result';
import type { ReceiptFinancialEntry } from '../../customers/application/apply-receipt-result';
import type { ApplyReceiptResult } from '../../customers/application/receipt-submission-manager';
import type { Entrada } from '../domain/entrada';

function makeReceiptEntity(overrides: Partial<Entrada> = {}): Entrada {
  return {
    id: 'receipt-abc123',
    desc: 'Recebimento de João',
    valor: 45,
    edited: false,
    editReason: null,
    createdAt: 1,
    updatedAt: 2,
    dateISO: '2026-09-20',
    receiptOperationId: 'receipt-abc123',
    source: 'client_receipt',
    clientId: 'client-1',
    clientName: 'João',
    ...overrides,
  };
}

function makeAlreadyAppliedResult(): ApplyReceiptResult {
  return {
    clientes: [],
    receiptOperationId: 'receipt-abc123',
    status: 'already-applied',
    billingEntry: {
      receiptOperationId: 'receipt-abc123',
      source: 'client_receipt',
      clientId: 'client-1',
      clientName: 'João',
      desc: 'Recebimento de João',
      valor: 45,
      data: '20/09/2026',
      dateISO: '2026-09-20',
      createdAt: 3,
      updatedAt: 4,
    },
  };
}

describe('entradaToEntryVM — identidade de recebimento preservada na ponte', () => {
  it('preserva fsId, receiptOperationId, source, clientId e clientName', () => {
    const vm = entradaToEntryVM(makeReceiptEntity());

    expect(vm.fsId).toBe('receipt-abc123');
    expect(vm.receiptOperationId).toBe('receipt-abc123');
    expect(vm.source).toBe('client_receipt');
    expect(vm.clientId).toBe('client-1');
    expect(vm.clientName).toBe('João');
    expect(vm.valor).toBe(45);
    expect(vm.dateISO).toBe('2026-09-20');
  });

  it('entrada manual não ganha identidade de recebimento', () => {
    const manual: Entrada = {
      id: 'manual-abc',
      desc: 'Avulso',
      valor: 10,
      dateISO: '2026-09-22',
      edited: false,
      editReason: null,
      createdAt: 1,
      updatedAt: 2,
    };
    const vm = entradaToEntryVM(manual);

    expect(vm.receiptOperationId).toBeUndefined();
    expect(vm.clientName).toBeUndefined();
    expect(vm.fsId).toBe('manual-abc');
  });

  it('dataLabelForISO retorna o rótulo determinístico', () => {
    expect(dateLabelForISO('2026-09-23', '2026-09-23')).toBe('Hoje');
    expect(dateLabelForISO('2026-09-22', '2026-09-23')).toBe('Ontem');
    expect(dateLabelForISO('2026-09-10', '2026-09-23')).toBe('10/09/2026');
    expect(dateLabelForISO('2025-12-31', '2026-09-23')).toBe('31/12/2025');
  });
});

describe('reidratação de recebimento — aparece uma vez mesmo após retry já-aplicado', () => {
  it('entrada reidratada do Firestore entra uma única vez e retry already-applied não duplica', () => {
    // 1. Recebimento confirmado grava entradas/{receiptOperationId} no Firestore.
    // 2. Nova instância (localStorage limpo) carrega as entradas do Firestore:
    //    o mapper converte doc id → receiptOperationId e a VM preserva a identidade.
    const rehydrated = entradaToEntryVM(makeReceiptEntity());

    // A entrada aparece UMA vez no estado local da nova instância.
    const entradas: ReceiptFinancialEntry[] = [rehydrated as unknown as ReceiptFinancialEntry];
    expect(entradas).toHaveLength(1);

    // 3. Novo retry do mesmo recebimento volta already-applied (idempotente).
    const applied = applyReceiptResult({ clientes: [], entradas }, makeAlreadyAppliedResult());

    // A entrada continua aparecendo UMA vez — o upsert por receiptOperationId encontrou a existente.
    expect(applied.entradas).toHaveLength(1);
    expect(applied.entradas[0].receiptOperationId).toBe('receipt-abc123');
    expect(applied.entradas[0].clientName).toBe('João');
  });

  it('recebimento legado (doc id = receiptOperationId) também não duplica no retry', () => {
    const legacy: Entrada = {
      id: 'receipt-legacy-9',
      desc: 'Recebimento de Maria',
      valor: 90,
      dateISO: '2026-09-21',
      edited: false,
      editReason: null,
      createdAt: 1,
      updatedAt: 2,
      receiptOperationId: 'receipt-legacy-9',
      source: 'client_receipt',
      clientName: 'Maria',
    };
    const rehydrated = entradaToEntryVM(legacy);
    const entradas: ReceiptFinancialEntry[] = [rehydrated as unknown as ReceiptFinancialEntry];
    const applied = applyReceiptResult(
      { clientes: [], entradas },
      {
        clientes: [],
        receiptOperationId: 'receipt-legacy-9',
        status: 'already-applied',
        billingEntry: {
          receiptOperationId: 'receipt-legacy-9',
          source: 'client_receipt',
          clientId: null,
          clientName: 'Maria',
          desc: 'Recebimento de Maria',
          valor: 90,
          data: '21/09/2026',
          dateISO: '2026-09-21',
          createdAt: 3,
          updatedAt: 4,
        },
      },
    );

    expect(applied.entradas).toHaveLength(1);
    expect(applied.entradas[0].receiptOperationId).toBe('receipt-legacy-9');
  });
});
