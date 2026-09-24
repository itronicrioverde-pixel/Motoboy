import { describe, it, expect } from 'vitest';
import { createLocalStorageReceiptAttemptStore, receiptAttemptKey } from './local-storage-receipt-attempt-store';
import type { ReceiptAttemptStorage } from './local-storage-receipt-attempt-store';
import type { PendingReceiptAttempt } from '../application/receipt-submission-manager';

function makeAttempt(overrides: Partial<PendingReceiptAttempt> = {}): PendingReceiptAttempt {
  return {
    uid: 'user-1',
    receiptOperationId: 'receipt-abc',
    clientId: 'c1',
    valor: 30,
    dateISO: '2026-09-23',
    dateLabel: 'Hoje',
    createdAt: 1,
    ...overrides,
  };
}

function makeFakeStorage() {
  const items = new Map<string, string>();
  const storage: ReceiptAttemptStorage = {
    getItem: (key) => (items.has(key) ? items.get(key)! : null),
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
  return { storage, items };
}

describe('createLocalStorageReceiptAttemptStore', () => {
  it('#1 save + load roundtrip preserva todos os campos', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    const attempt = makeAttempt();

    store.save(attempt);
    const loaded = store.load('user-1');

    expect(loaded).toEqual(attempt);
  });

  it('#1b clientName do momento da submissão é preservado no roundtrip', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    const attempt = makeAttempt({ clientName: 'Ana' });

    store.save(attempt);
    const loaded = store.load('user-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.clientName).toBe('Ana');
    expect(loaded).toEqual(attempt);
  });

  it('#1c tentativa antiga sem clientName continua válida na leitura (clienteName fica indefinido)', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    storage.setItem(
      receiptAttemptKey('user-1'),
      JSON.stringify({
        uid: 'user-1',
        receiptOperationId: 'receipt-abc',
        clientId: 'c1',
        valor: 30,
        dateISO: '2026-09-23',
        dateLabel: 'Hoje',
        createdAt: 1,
      }),
    );

    const loaded = store.load('user-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.clientName).toBeUndefined();
  });

  it('#2 load com outro UID retorna null (isolamento por usuário)', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    store.save(makeAttempt());

    expect(store.load('user-2')).toBeNull();
    expect(store.load('user-1')).not.toBeNull();
  });

  it('#3 clear só remove quando uid e receiptOperationId coincidem', () => {
    const { storage, items } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    store.save(makeAttempt({ receiptOperationId: 'receipt-abc' }));

    store.clear('user-1', 'receipt-outro');
    expect(items.has(receiptAttemptKey('user-1'))).toBe(true);

    store.clear('user-2', 'receipt-abc');
    expect(items.has(receiptAttemptKey('user-1'))).toBe(true);

    store.clear('user-1', 'receipt-abc');
    expect(items.has(receiptAttemptKey('user-1'))).toBe(false);
  });

  it('#4 payload incompleto (sem valor) é rejeitado na leitura', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    store.save(makeAttempt());
    storage.setItem(
      receiptAttemptKey('user-1'),
      JSON.stringify({ uid: 'user-1', receiptOperationId: 'receipt-abc', dateISO: '2026-09-23' }),
    );

    expect(store.load('user-1')).toBeNull();
  });

  it('#5 valor zero, negativo ou não finito é rejeitado na leitura', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);

    for (const valor of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const attempt = makeAttempt({ valor });
      storage.setItem(receiptAttemptKey('user-1'), JSON.stringify(attempt));
      expect(store.load('user-1')).toBeNull();
    }
  });

  it('#6 receiptOperationId vazio é rejeitado na leitura', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    storage.setItem(receiptAttemptKey('user-1'), JSON.stringify(makeAttempt({ receiptOperationId: '' })));

    expect(store.load('user-1')).toBeNull();
  });

  it('#7 JSON inválido retorna null (leitura tolerante)', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);
    storage.setItem(receiptAttemptKey('user-1'), '{nao-json');

    expect(store.load('user-1')).toBeNull();
  });

  it('#8 save rejeita payload inválida lançando erro', () => {
    const { storage } = makeFakeStorage();
    const store = createLocalStorageReceiptAttemptStore(storage);

    expect(() => store.save(makeAttempt({ valor: Number.NaN }))).toThrow();
    expect(() => store.save({} as PendingReceiptAttempt)).toThrow();
  });
});