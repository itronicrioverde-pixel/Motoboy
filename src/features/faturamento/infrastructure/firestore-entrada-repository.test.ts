import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/firebase.js', () => ({ db: { _type: 'firestore' } }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
}));

import { entradaFromSnapshot } from './firestore-entrada-repository';

interface FakeData {
  [key: string]: unknown;
}

function fakeSnapshot(id: string, data: FakeData) {
  return { id, data: () => data } as never;
}

describe('entradaFromSnapshot — identidade de recebimento preservada', () => {
  it('recebimento gravado com receiptOperationId preserva todos os campos', () => {
    const data = {
      receiptOperationId: 'receipt-abc123',
      source: 'client_receipt',
      clientId: 'client-1',
      clientName: 'João',
      desc: 'Recebimento de João',
      valor: 42.5,
      dateISO: '2026-09-20',
      edited: false,
      editReason: null,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const entity = entradaFromSnapshot(fakeSnapshot('receipt-abc123', data));

    expect(entity.id).toBe('receipt-abc123');
    expect(entity.receiptOperationId).toBe('receipt-abc123');
    expect(entity.source).toBe('client_receipt');
    expect(entity.clientId).toBe('client-1');
    expect(entity.clientName).toBe('João');
    expect(entity.desc).toBe('Recebimento de João');
    expect(entity.valor).toBe(42.5);
    expect(entity.dateISO).toBe('2026-09-20');
  });

  it('recebimento legado sem campo receiptOperationId converte o ID do documento', () => {
    const legacy = fakeSnapshot('receipt-legacy-9', {
      source: 'client_receipt',
      clientName: 'Maria',
      desc: 'Recebimento de Maria',
      valor: 90,
      dateISO: '2026-09-21',
    });

    const entity = entradaFromSnapshot(legacy);
    expect(entity.receiptOperationId).toBe('receipt-legacy-9');
    expect(entity.source).toBe('client_receipt');
    expect(entity.clientName).toBe('Maria');
  });

  it('entrada manual não ganha identidade de recebimento', () => {
    const entity = entradaFromSnapshot(
      fakeSnapshot('manual-abc', {
        desc: 'Trabalho avulso',
        valor: 120,
        dateISO: '2026-09-22',
      }),
    );

    expect(entity.receiptOperationId).toBeUndefined();
    expect(entity.source).toBeNull();
    expect(entity.clientId).toBeNull();
    expect(entity.clientName).toBeNull();
    expect(entity.id).toBe('manual-abc');
  });

  it('campos ausentes viram os defaults de segurança', () => {
    const entity = entradaFromSnapshot(fakeSnapshot('x', {}));
    expect(entity.desc).toBe('');
    expect(entity.valor).toBe(0);
    expect(entity.dateISO).toBe('');
    expect(entity.edited).toBe(false);
    expect(entity.editReason).toBeNull();
  });
});