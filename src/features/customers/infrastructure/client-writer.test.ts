import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase.js', () => ({ db: { _type: 'firestore' } }));
vi.mock('../../auth/application/auth-service', () => ({
  currentUid: () => mockCurrentUid(),
}));

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  doc: vi.fn(),
  collection: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  collection: mocks.collection,
  runTransaction: mocks.runTransaction,
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
  deleteDoc: mocks.deleteDoc,
}));

mocks.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({
  _type: 'collection',
  path: segments.join('/'),
}));
mocks.doc.mockImplementation((...args: unknown[]) => {
  const parts: string[] = [];
  for (const arg of args) {
    if (arg && typeof arg === 'object' && 'path' in arg) {
      parts.push((arg as { path: string }).path);
    } else if (typeof arg === 'string') {
      parts.push(arg);
    }
  }
  return { _path: parts.join('/') };
});

const mockCurrentUid = vi.fn().mockReturnValue('uid-1');

import {
  createClientDual,
  updateClientDual,
  removeClientDual,
  applyRoutePendingsDual,
  applyReceiptDual,
  cancelRouteDual,
} from './client-writer';
import type { ApplyReceiptInput, ReceiptBillingEntry } from './client-writer';

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => ({ clientes: [] }),
    }),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

/**
 * Buffer de escritas transacional.
 * tx.set adiciona ao buffer; o commit aplica.
 * Se o callback lançar erro, o buffer inteiro é descartado.
 */
interface TxEntry { ref: unknown; data: unknown; options?: unknown; }
interface BufferedTx {
  tx: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  commitBuffer: () => TxEntry[];
  discarded: boolean;
}

function makeBufferedTx(
  getClientData: () => unknown,
  onCommit?: ((entries: TxEntry[]) => void) | { get?: ReturnType<typeof vi.fn>; onCommit?: (entries: TxEntry[]) => void },
): BufferedTx {
  const buffer: TxEntry[] = [];
  let discarded = false;
  const opts = typeof onCommit === 'function'
    ? { onCommit }
    : (onCommit ?? {});
  const tx = {
    get: opts.get ?? vi.fn().mockImplementation(async () => ({
      exists: () => true,
      data: () => getClientData(),
    })),
    set: vi.fn((_ref: unknown, _data: unknown, _options?: unknown) => {
      buffer.push({ ref: _ref, data: _data, options: _options });
    }),
    update: vi.fn(),
    delete: vi.fn(),
  };

  return {
    tx,
    commitBuffer: () => {
      if (opts.onCommit) opts.onCommit([...buffer]);
      const result = [...buffer];
      buffer.length = 0;
      return result;
    },
    get discarded() { return discarded; },
  };
}

function extractBillingEntryFromBuffer(entries: TxEntry[]): ReceiptBillingEntry | null {
  const entrada = entries.find(({ ref }) => {
    const path = (ref as { _path?: string })._path ?? '';
    return path.includes('/entradas/');
  });
  return entrada ? (entrada.data as ReceiptBillingEntry) : null;
}

function receiptInput(overrides: Partial<ApplyReceiptInput> & { valor: number }): ApplyReceiptInput {
  return {
    clientId: 'c1',
    dateISO: '2026-09-21',
    dateLabel: '21/09/2026',
    receiptOperationId: 'receipt-test-1',
    ...overrides,
  };
}

describe('ClientWriter — CRUD atômico em duas fontes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUid.mockReturnValue('uid-1');
  });

  describe('createClientDual', () => {
    it('executa exatamente 1 transação', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await createClientDual({ name: 'Ana' });

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('grava customers/{id} e clients/data (2 sets na transação)', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await createClientDual({ name: 'Ana' });

      expect(tx.set).toHaveBeenCalledTimes(2);
    });

    it('retorna o ID gerado como string não vazia', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const id = await createClientDual({ name: 'Ana' });

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('callback executado duas vezes mantém o mesmo ID', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        await fn(tx);
      });

      const id = await createClientDual({ name: 'Ana' });

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(tx.set).toHaveBeenCalledTimes(4);
      const customerPaths = tx.set.mock.calls
        .map(([ref]) => (ref as { _path?: string })._path ?? '')
        .filter((path) => path.includes('/customers/'));
      expect(customerPaths).toEqual([
        `users/uid-1/customers/${id}`,
        `users/uid-1/customers/${id}`,
      ]);
    });
  });

  describe('updateClientDual', () => {
    it('executa exatamente 1 transação', async () => {
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: [{ id: 'c1', nome: 'Ana' }] }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await updateClientDual('c1', { name: 'Ana Silva' });

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    });

    it('atualiza apenas o cliente correto no array', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: 'c2', nome: 'Bruno', pendente: 0, contas: [{ saldo: 50 }], recebimentos: [] },
      ];
      let writtenData: unknown = null;
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
        set: vi.fn((_ref: unknown, data: unknown) => { writtenData = data; }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await updateClientDual('c1', { name: 'Ana Silva' });

      const clientes = (writtenData as { clientes: Array<{ id: string; nome: string }> }).clientes;
      const bruno = clientes.find((c) => c.id === 'c2');
      expect(bruno!.nome).toBe('Bruno');
    });
  });

  describe('updateClientDual — migração de legado', () => {
    it('cliente sem ID gera migração transacional com novo ID', async () => {
      const existing = [
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
      ];
      let writtenData: unknown = null;
      let profileWritten: unknown = null;
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
        set: vi.fn((_ref: unknown, data: unknown, options?: unknown) => {
          if(options && typeof options === 'object' && 'merge' in options) writtenData = data;
          else profileWritten = data;
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const resolvedId = await updateClientDual('', { name: 'Ana Silva', legacyLookupName: 'Ana' });

      expect(typeof resolvedId).toBe('string');
      expect(resolvedId.length).toBeGreaterThan(0);
      expect(profileWritten).toBeTruthy();
      const financial = (writtenData as { clientes: Array<{ id: string; nome: string }> }).clientes;
      expect(financial[0].id).toBe(resolvedId);
      expect(financial[0].nome).toBe('Ana Silva');
    });

    it('rejeita se múltiplos clientes legados têm o mesmo nome', async () => {
      const existing = [
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(updateClientDual('', { name: 'Ana', legacyLookupName: 'Ana' })).rejects.toThrow('Conflito');
    });

    it('nome de busca inexistente não escreve nada', async () => {
      const existing = [
        { id: '', nome: 'Bruno', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(updateClientDual('', { name: 'Ana Silva', legacyLookupName: 'Ana' })).rejects.toThrow('Nenhum cliente legado encontrado');
      expect(tx.set).not.toHaveBeenCalled();
    });
  });

  describe('removeClientDual — legado sem ID', () => {
    it('remove entrada financeira de cliente legado sem ID', async () => {
      const existing = [
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: 'c2', nome: 'Bruno', pendente: 0, contas: [], recebimentos: [] },
      ];
      let writtenData: unknown = null;
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
        set: vi.fn((_ref: unknown, data: unknown) => { writtenData = data; }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await removeClientDual('', { legacyLookupName: 'Ana' });

      const remaining = (writtenData as { clientes: Array<{ id: string }> }).clientes;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('c2');
    });

    it('rejeita exclusão de legado com nomes duplicados', async () => {
      const existing = [
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(removeClientDual('', { legacyLookupName: 'Ana' })).rejects.toThrow('Conflito');
    });

    it('nome de busca inexistente não escreve nada', async () => {
      const existing = [
        { id: '', nome: 'Bruno', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(removeClientDual('', { legacyLookupName: 'Ana' })).rejects.toThrow('Nenhum cliente legado encontrado');
      expect(tx.set).not.toHaveBeenCalled();
      expect(tx.delete).not.toHaveBeenCalled();
    });

    it('dois legados com mesmo nome não executam tx.set, tx.update ou tx.delete', async () => {
      const existing = [
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: '', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(removeClientDual('', { legacyLookupName: 'Ana' })).rejects.toThrow('Conflito');
      expect(tx.set).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.delete).not.toHaveBeenCalled();
    });
  });

  describe('removeClientDual', () => {
    it('remove cliente e grava array reduzido', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: 'c2', nome: 'Bruno', pendente: 0, contas: [], recebimentos: [] },
      ];
      let writtenData: unknown = null;
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
        set: vi.fn((_ref: unknown, data: unknown) => { writtenData = data; }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await removeClientDual('c1');

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      const remaining = (writtenData as { clientes: Array<{ id: string }> }).clientes;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('c2');
    });
  });

  describe('applyRoutePendingsDual', () => {
    it('aplica duas pendências em uma única transação', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota · 2 entrega(s)' },
          { serviceId: 'svc-bbb', nome: 'Bruno', valor: 30, desc: 'Rota · 1 entrega(s)' },
        ],
        'r1',
      );

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect((result[0].contas[0] as { operationId: string }).operationId).toBe('r1:svc-aaa');
    });

    it('duas pendências do mesmo cliente são acumuladas', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota · 2 entrega(s)' },
          { serviceId: 'svc-bbb', nome: 'Ana', valor: 30, desc: 'Rota · 1 entrega(s)' },
        ],
        'r1',
      );

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      const ana = result.find((c) => c.nome === 'Ana');
      expect(ana).toBeDefined();
      expect(ana!.contas).toHaveLength(2);
      expect(ana!.pendente).toBe(80);
    });

    it('falha antes do commit não altera Firestore', async () => {
      mocks.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('Transaction failed');
    });

    it('retorna array vazio para lista vazia', async () => {
      const result = await applyRoutePendingsDual([], 'r1');
      expect(result).toEqual([]);
      expect(mocks.runTransaction).not.toHaveBeenCalled();
    });

    it('lança erro quando UID é null', async () => {
      mockCurrentUid.mockReturnValue(null);

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('Sem usuário autenticado.');
    });

    it('rejeita serviceId vazio em vez de aceitar operationId arbitrário', async () => {
      await expect(
        applyRoutePendingsDual(
          [{ serviceId: '', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('serviceId');
    });

    it('dois clientes novos com nomes iguais recebem o mesmo ID (mesmo cliente)', async () => {
      const tx = makeTx();
      const createdIds: string[] = [];
      tx.set = vi.fn((_ref: unknown, data: unknown) => {
        const d = data as { name?: string };
        if (d && d.name) {
          const ref = _ref as { _path?: string };
          if (ref._path && ref._path.includes('customers')) {
            const id = ref._path.split('/').pop();
            if (id) createdIds.push(id);
          }
        }
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await applyRoutePendingsDual(
        [
          { serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' },
          { serviceId: 'svc-bbb', nome: 'Ana', valor: 30, desc: 'test2' },
        ],
        'r1',
      );

      expect(createdIds.length).toBe(1);
    });

    it('reexecução do callback mantém os mesmos IDs pré-gerados', async () => {
      const tx = makeTx();
      const idsPerExecution: string[][] = [];
      tx.set = vi.fn((_ref: unknown, data: unknown) => {
        const d = data as { name?: string };
        if (d && d.name) {
          const ref = _ref as { _path?: string };
          if (ref._path && ref._path.includes('customers')) {
            const id = ref._path.split('/').pop();
            if (id) {
              if (idsPerExecution.length === 0) idsPerExecution.push([]);
              idsPerExecution[idsPerExecution.length - 1].push(id);
            }
          }
        }
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        idsPerExecution.push([]);
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
        'r1',
      );

      expect(result).toHaveLength(1);
      expect(idsPerExecution.length).toBeGreaterThanOrEqual(2);
      const firstRunIds = idsPerExecution[0];
      const secondRunIds = idsPerExecution[1];
      expect(firstRunIds.length).toBeGreaterThan(0);
      expect(firstRunIds).toEqual(secondRunIds);
    });

    it('reexecução do callback mantém ID e data da conta pré-gerados', async () => {
      const tx = makeTx();
      const writtenAccounts: Array<{ id: string; dateISO: string; operationId: string }> = [];
      tx.set = vi.fn((_ref: unknown, data: unknown) => {
        const payload = data as { clientes?: Array<{ contas: Array<{ id: string; dateISO: string; operationId: string }> }> };
        if (payload.clientes?.[0]?.contas[0]) {
          writtenAccounts.push(payload.clientes[0].contas[0]);
        }
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        await fn(tx);
      });

      await applyRoutePendingsDual(
        [{ serviceId: 'svc-stable', nome: 'Ana', valor: 50, desc: 'test' }],
        'route-stable',
      );

      expect(writtenAccounts).toHaveLength(2);
      expect(writtenAccounts[0]).toEqual(writtenAccounts[1]);
      expect(writtenAccounts[0].operationId).toBe('route-stable:svc-stable');
    });

    it('ignora operationId arbitrário do chamador e deriva identidade de routeId + serviceId', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });
      const forgedItem = {
        serviceId: 'svc-real',
        operationId: 'outra-rota:svc-falsa',
        nome: 'Ana',
        valor: 50,
        desc: 'test',
      } as unknown as Parameters<typeof applyRoutePendingsDual>[0][number];

      const result = await applyRoutePendingsDual([forgedItem], 'route-real');

      expect((result[0].contas[0] as { operationId: string }).operationId)
        .toBe('route-real:svc-real');
    });

    it('ignora pendências com operationId duplicado dentro da mesma transação', async () => {
      const tx = makeTx();
      tx.set = vi.fn();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' },
          { serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' },
        ],
        'r1',
      );

      const ana = result.find((c) => c.nome === 'Ana');
      expect(ana!.contas).toHaveLength(1);
    });

    it('lança conflito quando mesmo operationId tem conteúdo diferente', async () => {
      const existing = [{
        id: 'c1',
        nome: 'Ana',
        pendente: 50,
        contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'old' }],
        recebimentos: [],
      }];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 99, desc: 'new' }],
          'r1',
        ),
      ).rejects.toThrow('Conflito de operationId');
    });

    it('retry com mesmo conteúdo não duplica', async () => {
      const existing = [{
        id: 'c1',
        nome: 'Ana',
        pendente: 50,
        contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'Rota' }],
        recebimentos: [],
      }];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota' }],
        'r1',
      );

      const ana = result.find((c) => c.nome === 'Ana');
      expect(ana!.contas).toHaveLength(1);
    });

    it('retry com valor alterado detecta conflito', async () => {
      const existing = [{
        id: 'c1',
        nome: 'Ana',
        pendente: 50,
        contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'Rota' }],
        recebimentos: [],
      }];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 99, desc: 'Rota' }],
          'r1',
        ),
      ).rejects.toThrow('Conflito de operationId');
    });

    it('mistura clientes existentes e novos corretamente', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana', pendente: 10, contas: [{ saldo: 10, operationId: 'old' }], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota' },
          { serviceId: 'svc-bbb', nome: 'Bruno', valor: 30, desc: 'Rota' },
        ],
        'r1',
      );

      expect(result).toHaveLength(2);
      const ana = result.find((c) => c.nome === 'Ana');
      expect(ana!.contas).toHaveLength(2);
      expect(ana!.pendente).toBe(60);
      const bruno = result.find((c) => c.nome === 'Bruno');
      expect(bruno!.contas).toHaveLength(1);
      expect(bruno!.pendente).toBe(30);
    });

    it('mantém contas anteriores do cliente ao adicionar nova pendência', async () => {
      const existing = [
        {
          id: 'c1',
          nome: 'Ana',
          pendente: 20,
          contas: [{ saldo: 20, operationId: 'old-r1', desc: 'Rota anterior' }],
          recebimentos: [],
        },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'Nova rota' }],
        'r2',
      );

      const ana = result.find((c) => c.nome === 'Ana');
      expect(ana!.contas).toHaveLength(2);
      expect(ana!.pendente).toBe(70);
    });
  });

  describe('falha de transação — nenhuma fonte é alterada', () => {
    it('createClientDual propaga erro', async () => {
      mocks.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(
        createClientDual({ name: 'Ana' }),
      ).rejects.toThrow('Transaction failed');
    });

    it('updateClientDual propaga erro', async () => {
      mocks.runTransaction.mockRejectedValue(new Error('Permission denied'));

      await expect(
        updateClientDual('c1', { name: 'Ana' }),
      ).rejects.toThrow('Permission denied');
    });

    it('removeClientDual propaga erro', async () => {
      mocks.runTransaction.mockRejectedValue(new Error('Network error'));

      await expect(
        removeClientDual('c1'),
      ).rejects.toThrow('Network error');
    });

    it('applyRoutePendingsDual propaga erro', async () => {
      mocks.runTransaction.mockRejectedValue(new Error('Network error'));

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 10, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('Network error');
    });
  });

  describe('UID obrigatório', () => {
    it('createClientDual lança erro sem UID', async () => {
      mockCurrentUid.mockReturnValue(null);
      await expect(createClientDual({ name: 'Ana' })).rejects.toThrow('Sem usuário autenticado.');
    });

    it('updateClientDual lança erro sem UID', async () => {
      mockCurrentUid.mockReturnValue(null);
      await expect(updateClientDual('c1', { name: 'Ana' })).rejects.toThrow('Sem usuário autenticado.');
    });

    it('removeClientDual lança erro sem UID', async () => {
      mockCurrentUid.mockReturnValue(null);
      await expect(removeClientDual('c1')).rejects.toThrow('Sem usuário autenticado.');
    });

    it('cancelRouteDual lança erro sem UID', async () => {
      mockCurrentUid.mockReturnValue(null);
      await expect(cancelRouteDual('r1')).rejects.toThrow('Sem usuário autenticado.');
    });
  });

  describe('applyRoutePendingsDual — identidade por clientId', () => {
    it('usa clientId para localizar cliente existente', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana Silva', pendente: 0, contas: [], recebimentos: [] },
        { id: 'c2', nome: 'Ana Costa', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', clientId: 'c2', nome: 'Ana Costa', valor: 50, desc: 'test' }],
        'r1',
      );

      const target = result.find((c) => c.id === 'c2');
      expect(target!.contas).toHaveLength(1);
      const other = result.find((c) => c.id === 'c1');
      expect(other!.contas).toHaveLength(0);
    });

    it('rejeita ambiguidade quando dois clientes têm o mesmo nome sem clientId', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: 'c2', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('Ambiguidade');
    });

    it('busca global de operationId detecta conflito em outro cliente', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana', pendente: 50, contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'test' }], recebimentos: [] },
        { id: 'c2', nome: 'Bruno', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', clientId: 'c2', nome: 'Bruno', valor: 99, desc: 'other' }],
          'r1',
        ),
      ).rejects.toThrow('Conflito de operationId');
    });

    it('dois clientes "Ana" com IDs diferentes recebem contas separadas', async () => {
      const existing = [
        { id: 'c1', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
        { id: 'c2', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { serviceId: 'svc-aaa', clientId: 'c1', nome: 'Ana', valor: 50, desc: 'test' },
          { serviceId: 'svc-bbb', clientId: 'c2', nome: 'Ana', valor: 30, desc: 'test' },
        ],
        'r1',
      );

      const c1 = result.find((c) => c.id === 'c1');
      const c2 = result.find((c) => c.id === 'c2');
      expect(c1!.contas).toHaveLength(1);
      expect(c2!.contas).toHaveLength(1);
      expect(c1!.pendente).toBe(50);
      expect(c2!.pendente).toBe(30);
    });

    it('cliente renomeado entre Fase 2 e retry não recebe duplicata', async () => {
      const existing = [
        {
          id: 'c1', nome: 'Ana Souza', pendente: 50,
          contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'Rota' }],
          recebimentos: [],
        },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', clientId: 'c1', nome: 'Ana', valor: 50, desc: 'Rota' }],
        'r1',
      );

      const c1 = result.find((c) => c.id === 'c1');
      expect(c1!.contas).toHaveLength(1);
    });

    it('clientId desconhecido lança erro em vez de criar cliente por nome', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', clientId: 'inexistente', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('Cliente não encontrado para clientId');
    });

    it('operationId idempotente quando mesmo cliente, valor e desc', async () => {
      const existing = [
        {
          id: 'c1', nome: 'Ana', pendente: 50,
          contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'test' }],
          recebimentos: [],
        },
      ];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', clientId: 'c1', nome: 'Ana', valor: 50, desc: 'test' }],
        'r1',
      );

      expect(result.find((c) => c.id === 'c1')!.contas).toHaveLength(1);
    });
  });

  describe('applyReceiptDual — contrato atômico', () => {
    it('commit bem-sucedido altera clients/data e cria entradas/{receiptOperationId}', async () => {
      const existing = [
        {
          id: 'c1', nome: 'Ana', pendente: 80,
          contas: [
            { id: 'nova', saldo: 30, recebido: 0, status: 'open' },
            { id: 'antiga', saldo: 50, recebido: 0, status: 'open' },
          ],
          recebimentos: [],
        },
        { id: 'c2', nome: 'Bruno', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] },
      ];
      let latestSnapshot = existing;
      let committedEntries: TxEntry[] = [];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        committedEntries = commitBuffer();
        for (const entry of committedEntries) {
          const path = (entry.ref as { _path?: string })._path ?? '';
          if (path.includes('/clients/')) latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
        }
      });

      const result = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 60, receiptOperationId: 'receipt-op-1',
      }));

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(committedEntries).toHaveLength(2);
      expect(result.status).toBe('applied');
      expect(result.receiptOperationId).toBe('receipt-op-1');
      expect(result.clientes).toHaveLength(2);
      const ana = result.clientes[0];
      expect(ana.pendente).toBe(20);
      expect(ana.recebimentos).toEqual([
        expect.objectContaining({ valor: 60, dateISO: '2026-09-21' }),
      ]);
      expect(ana.contas).toEqual([
        expect.objectContaining({ id: 'nova', saldo: 20, recebido: 10, status: 'partial' }),
        expect.objectContaining({ id: 'antiga', saldo: 0, recebido: 50, status: 'paid' }),
      ]);
      expect(result.clientes[1]).toBe(existing[1]);
      expect(result.billingEntry).toMatchObject({
        receiptOperationId: 'receipt-op-1',
        source: 'client_receipt',
        clientId: 'c1',
        clientName: 'Ana',
        desc: 'Recebimento de Ana',
        valor: 60,
      });
    });

    it('documento de faturamento usa receiptOperationId como ID do documento', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let committedEntries: TxEntry[] = [];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: existing }),
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        committedEntries = commitBuffer();
      });

      const result = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-doc-id',
      }));

      const entradasWrite = committedEntries.filter(({ ref }) => {
        const path = (ref as { _path?: string })._path ?? '';
        return path.includes('/entradas/');
      });
      expect(entradasWrite).toHaveLength(1);
      expect(extractBillingEntryFromBuffer(entradasWrite)).toMatchObject({
        receiptOperationId: 'receipt-doc-id',
        source: 'client_receipt',
      });
      expect(result.billingEntry.receiptOperationId).toBe('receipt-doc-id');
    });

    it('falha de commit preserva clients/data — nenhuma fonte é alterada', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const committedPaths: string[] = [];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        const entries = commitBuffer();
        const billingEntry = entries.find(({ ref }) => {
          const path = (ref as { _path?: string })._path ?? '';
          return path.includes('/entradas/');
        });
        if (billingEntry) {
          throw new Error('Firestore commit denied');
        }
        for (const entry of entries) {
          committedPaths.push((entry.ref as { _path?: string })._path ?? '');
        }
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-commit-fail',
      }))).rejects.toThrow('Firestore commit denied');
      expect(committedPaths).toHaveLength(0);
      expect(latestSnapshot).toBe(existing);
      expect(latestSnapshot[0].recebimentos).toHaveLength(0);
    });

    it('falha de commit não cria entradas/{receiptOperationId}', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      const committedData: unknown[] = [];
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        const entries = commitBuffer();
        if (entries.length === 2) {
          throw new Error('Firestore commit denied');
        }
        for (const entry of entries) {
          committedData.push(entry.data);
        }
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-no-entrada',
      }))).rejects.toThrow('Firestore commit denied');
      expect(committedData).toHaveLength(0);
    });

    it('callback prepara exatamente duas escritas na mesma transação', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let committedEntries: TxEntry[] = [];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: existing }),
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        committedEntries = commitBuffer();
      });

      await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-two-writes',
      }));

      expect(committedEntries).toHaveLength(2);
    });

    it('reexecução do callback reutiliza os mesmos dados preparados', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      const writtenReceipts: Array<{ id: string; valor: number; dateISO: string }> = [];
      const buffer: TxEntry[] = [];
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
      );
      tx.set = vi.fn((_ref: unknown, data: unknown, _options?: unknown) => {
        buffer.push({ ref: _ref, data, options: _options });
        const payload = data as { clientes?: Array<{ recebimentos: Array<{ id: string; valor: number; dateISO: string }> }> };
        if (payload?.clientes?.[0]?.recebimentos?.[0]) {
          writtenReceipts.push(payload.clientes[0].recebimentos[0]);
        }
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        await fn(tx);
      });

      await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-retry-1',
      }));

      expect(writtenReceipts).toHaveLength(2);
      expect(writtenReceipts[0]).toEqual(writtenReceipts[1]);
    });

    it('não ressuscita conta se o cancelamento venceu a concorrência', async () => {
      const existing = [{ id: 'c1', nome: 'Ana', pendente: 0, contas: [], recebimentos: [] }];
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 50, receiptOperationId: 'receipt-op-2',
      }))).rejects.toThrow('excede o saldo pendente atual');
      expect(tx.set).not.toHaveBeenCalled();
    });

    it('rejeita dois clientes legados de mesmo nome sem escolher o primeiro', async () => {
      const existing = [
        { nome: 'Ana', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] },
        { nome: 'Ana', pendente: 20, contas: [{ saldo: 20 }], recebimentos: [] },
      ];
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: undefined, legacyLookupName: 'Ana', valor: 10, receiptOperationId: 'receipt-op-3',
      }))).rejects.toThrow('Conflito');
      expect(tx.set).not.toHaveBeenCalled();
    });

    it('falha não altera os objetos de entrada usados no teste', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      const originalExisting = JSON.parse(JSON.stringify(existing));
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        throw new Error('Commit failed');
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-obj-intact',
      }))).rejects.toThrow('Commit failed');

      expect(existing).toEqual(originalExisting);
      expect(existing[0].recebimentos).toHaveLength(0);
      expect(existing[0].contas[0].saldo).toBe(50);
    });
  });

  describe('cancelRouteDual', () => {
    it('remove contas da rota e recalcula pendente atomicamente', async () => {
      const existing = [
        {
          id: 'c1', nome: 'Ana', pendente: 80,
          contas: [
            { routeId: 'r1', saldo: 50, operationId: 'r1:svc-aaa', recebido: 0 },
            { routeId: 'r2', saldo: 30, operationId: 'r2:svc-bbb', recebido: 0 },
          ],
          recebimentos: [],
        },
      ];
      const tx = makeTx({
        get: vi.fn()
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'r1' }) })
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ clientes: existing }) }),
        delete: vi.fn(),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await cancelRouteDual('r1');

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(tx.get).toHaveBeenCalledTimes(2);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      const ana = result.find((c) => c.id === 'c1');
      expect(ana!.contas).toHaveLength(1);
      expect(ana!.pendente).toBe(30);
    });

    it('lança erro com routeId vazio', async () => {
      await expect(cancelRouteDual('')).rejects.toThrow('routeId obrigatório');
    });

    it('propaga erro de transação', async () => {
      mocks.runTransaction.mockRejectedValue(new Error('Network error'));
      await expect(cancelRouteDual('r1')).rejects.toThrow('Network error');
    });

    it('rejeita se rota não existe no Firestore', async () => {
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        delete: vi.fn(),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(cancelRouteDual('r1')).rejects.toThrow('não encontrada');
      expect(tx.delete).not.toHaveBeenCalled();
      expect(tx.set).not.toHaveBeenCalled();
    });

    it('pagamento remoto parcial bloqueia cancelamento dentro da transação', async () => {
      const existing = [
        {
          id: 'c1', nome: 'Ana', pendente: 30,
          contas: [
            { routeId: 'r1', saldo: 30, valorOriginal: 50, recebido: 20, operationId: 'r1:svc-aaa' },
          ],
          recebimentos: [],
        },
      ];
      const tx = makeTx({
        get: vi.fn()
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'r1' }) })
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ clientes: existing }) }),
        delete: vi.fn(),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(cancelRouteDual('r1')).rejects.toThrow('já recebeu pagamento');
      expect(tx.set).not.toHaveBeenCalled();
      expect(tx.delete).not.toHaveBeenCalled();
    });
  });

  describe('contratos comportamentais — recebimento', () => {
    it('falha no recebimento não altera memória nem faturamento', async () => {
      const existing = [
        {
          id: 'c1', nome: 'Ana', pendente: 30,
          contas: [{ id: 'conta-1', saldo: 30, recebido: 0, status: 'open' }],
          recebimentos: [],
        },
      ];
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 100, receiptOperationId: 'receipt-fail-1',
      }))).rejects.toThrow('excede o saldo');
      expect(tx.set).not.toHaveBeenCalled();
    });

    it('duas submissões concorrentes com o mesmo receiptOperationId são idempotentes', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const committedPaths: string[] = [];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
            }
            committedPaths.push(path);
          }
        },
      );
      let callCount = 0;
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        callCount++;
        await fn(tx);
        commitBuffer();
      });

      const input = receiptInput({ clientId: 'c1', valor: 20, receiptOperationId: 'receipt-ui-1' });
      const r1 = await applyReceiptDual(input);
      const r2 = await applyReceiptDual(input);

      expect(callCount).toBe(2);
      expect(r1.clientes[0].recebimentos).toHaveLength(1);
      expect(r2.clientes[0].recebimentos).toHaveLength(1);
      expect(r1.status).toBe('applied');
      expect(r2.status).toBe('already-applied');
      expect(r1.clientes[0].pendente).toBe(r2.clientes[0].pendente);
      expect(committedPaths.filter((p) => p.includes('/entradas/'))).toHaveLength(1);
    });

    it('duas operações legítimas com IDs diferentes acumulam recebimentos', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
            }
          }
        },
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        commitBuffer();
      });

      const r1 = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-legit-1',
      }));
      expect(r1.status).toBe('applied');
      expect(r1.clientes[0].recebimentos).toHaveLength(1);

      const r2 = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 10, receiptOperationId: 'receipt-legit-2',
        dateISO: '2026-09-22', dateLabel: '22/09/2026',
      }));
      expect(r2.status).toBe('applied');
      expect(r2.clientes[0].recebimentos).toHaveLength(2);
      expect(r2.clientes[0].pendente).toBe(20);
    });

    it('concorrência: receipt com saldo suficiente impede cancelamento', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ routeId: 'r1', saldo: 50, recebido: 0, operationId: 'r1:svc-aaa' }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
            }
          }
        },
      );
      mocks.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        commitBuffer();
      });

      await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 30, receiptOperationId: 'receipt-concurrent-1',
      }));

      const cancelTx = makeTx({
        get: vi.fn()
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'r1' }) })
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ clientes: latestSnapshot }) }),
        delete: vi.fn(),
      });
      mocks.runTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(cancelTx);
      });

      await expect(cancelRouteDual('r1')).rejects.toThrow('já recebeu pagamento');
      expect(cancelTx.delete).not.toHaveBeenCalled();
    });

    it('troca de UID não escreve na conta anterior nem na nova indevidamente', async () => {
      const existingUid1 = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existingUid1;
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existingUid1 }).clientes;
            }
          }
        },
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        commitBuffer();
      });

      const r1 = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-uid-1',
      }));
      expect(r1.status).toBe('applied');
      expect(r1.billingEntry.clientId).toBe('c1');

      mockCurrentUid.mockReturnValue('uid-2');
      const r2 = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 10, receiptOperationId: 'receipt-uid-2',
        dateISO: '2026-09-22', dateLabel: '22/09/2026',
      }));
      expect(r2.status).toBe('applied');
      expect(r2.billingEntry.clientId).toBe('c1');
    });
  });

  describe('contratos comportamentais — cancelamento', () => {
    it('falha no cancelamento preserva rota, contas e estado local', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ routeId: 'r1', saldo: 50, recebido: 20, operationId: 'r1:svc-aaa' }],
        recebimentos: [],
      }];
      let writtenData: unknown = null;
      const tx = makeTx({
        get: vi.fn()
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'r1' }) })
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ clientes: existing }) }),
        set: vi.fn((_ref: unknown, data: unknown) => { writtenData = data; }),
        delete: vi.fn(),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(cancelRouteDual('r1')).rejects.toThrow('já recebeu pagamento');
      expect(writtenData).toBeNull();
      expect(tx.delete).not.toHaveBeenCalled();
    });

    it('dois clientes legados sem ID com mesmo nome permanecem intactos após cancelamento', async () => {
      const existing = [
        { id: '', nome: 'Ana', pendente: 30, contas: [{ routeId: 'r1', saldo: 30, recebido: 0 }], recebimentos: [] },
        { id: '', nome: 'Ana', pendente: 20, contas: [{ routeId: 'r1', saldo: 20, recebido: 0 }], recebimentos: [] },
        { id: 'c3', nome: 'Bruno', pendente: 10, contas: [{ routeId: 'r1', saldo: 10, recebido: 0 }], recebimentos: [] },
      ];
      const tx = makeTx({
        get: vi.fn()
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'r1' }) })
          .mockResolvedValueOnce({ exists: () => true, data: () => ({ clientes: existing }) }),
        delete: vi.fn(),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await cancelRouteDual('r1');

      expect(result).toHaveLength(3);
      const legacyAnas = result.filter((c) => c.nome === 'Ana');
      expect(legacyAnas).toHaveLength(2);
      expect(legacyAnas[0].contas).toHaveLength(0);
      expect(legacyAnas[0].pendente).toBe(0);
      expect(legacyAnas[1].contas).toHaveLength(0);
      expect(legacyAnas[1].pendente).toBe(0);
      const bruno = result.find((c) => c.id === 'c3');
      expect(bruno!.contas).toHaveLength(0);
      expect(bruno!.pendente).toBe(0);
      expect(tx.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('contratos comportamentais — pendências de rota', () => {
    it('routeId vazio é rejeitado', async () => {
      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
          '',
        ),
      ).rejects.toThrow('routeId obrigatório');
    });

    it('serviceId vazio é rejeitado', async () => {
      await expect(
        applyRoutePendingsDual(
          [{ serviceId: '', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('serviceId');
    });

    it('reexecução do callback mantém ID, data e conteúdo da conta', async () => {
      const tx = makeTx();
      const writtenAccounts: Array<{ id: string; dateISO: string; operationId: string; valorOriginal: number; desc: string }> = [];
      tx.set = vi.fn((_ref: unknown, data: unknown) => {
        const payload = data as { clientes?: Array<{ contas: Array<{ id: string; dateISO: string; operationId: string; valorOriginal: number; desc: string }> }> };
        if (payload.clientes?.[0]?.contas[0]) {
          writtenAccounts.push({ ...payload.clientes[0].contas[0] });
        }
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        await fn(tx);
      });

      await applyRoutePendingsDual(
        [{ serviceId: 'svc-stable', nome: 'Ana', valor: 50, desc: 'Rota · 2 entrega(s)' }],
        'route-stable',
      );

      expect(writtenAccounts).toHaveLength(2);
      expect(writtenAccounts[0].id).toBe(writtenAccounts[1].id);
      expect(writtenAccounts[0].dateISO).toBe(writtenAccounts[1].dateISO);
      expect(writtenAccounts[0].operationId).toBe(writtenAccounts[1].operationId);
      expect(writtenAccounts[0].valorOriginal).toBe(writtenAccounts[1].valorOriginal);
      expect(writtenAccounts[0].desc).toBe(writtenAccounts[1].desc);
    });

    it('operationId é derivado de routeId + serviceId ignorando valor do chamador', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-x', nome: 'Ana', valor: 10, desc: 'd' } as never],
        'route-y',
      );

      expect((result[0].contas[0] as { operationId: string }).operationId).toBe('route-y:svc-x');
    });

    it('mesmo operationId e payload idempotente', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'Rota' }],
        recebimentos: [],
      }];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [{ serviceId: 'svc-aaa', clientId: 'c1', nome: 'Ana', valor: 50, desc: 'Rota' }],
        'r1',
      );

      expect(result.find((c) => c.id === 'c1')!.contas).toHaveLength(1);
    });

    it('mesmo operationId com payload diferente gera conflito', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ operationId: 'r1:svc-aaa', saldo: 50, valorOriginal: 50, desc: 'old' }],
        recebimentos: [],
      }];
      const tx = makeTx({
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ clientes: existing }),
        }),
      });
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(
        applyRoutePendingsDual(
          [{ serviceId: 'svc-aaa', nome: 'Ana', valor: 99, desc: 'new' }],
          'r1',
        ),
      ).rejects.toThrow('Conflito de operationId');
    });
  });

  describe('receiptOperationId — idempotência entre submissões', () => {
    it('rejeita receiptOperationId vazio', async () => {
      await expect(
        applyReceiptDual(receiptInput({
          clientId: 'c1', valor: 10, receiptOperationId: '',
        })),
      ).rejects.toThrow('receiptOperationId é obrigatório');
    });

    it('mesmo receiptOperationId e mesmo payload retorna already-applied sem tx.set', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [{
          receiptOperationId: 'receipt-stable-1', valor: 20, dateISO: '2026-09-21', data: '21/09/2026',
        }],
      }];
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const { clientes: result, billingEntry, status } = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-stable-1',
      }));

      expect(tx.set).not.toHaveBeenCalled();
      expect(status).toBe('already-applied');
      expect(billingEntry.receiptOperationId).toBe('receipt-stable-1');
      expect(billingEntry.source).toBe('client_receipt');
      expect(result[0].contas).toHaveLength(1);
      expect((result[0].contas[0] as { saldo: number }).saldo).toBe(50);
    });

    it('mesmo receiptOperationId com payload diferente gera conflito', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [{
          receiptOperationId: 'receipt-conflict-1', valor: 20, dateISO: '2026-09-21', data: '21/09/2026',
        }],
      }];
      const { tx } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 30, dateISO: '2026-09-22', dateLabel: '22/09/2026',
        receiptOperationId: 'receipt-conflict-1',
      }))).rejects.toThrow('Conflito de receiptOperationId');
    });

    it('receiptOperationId diferente permite dois recebimentos no mesmo cliente', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
            }
          }
        },
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        commitBuffer();
      });

      const r1 = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-a',
      }));
      expect(r1.status).toBe('applied');
      expect(r1.clientes[0].recebimentos).toHaveLength(1);

      const r2 = await applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 10, receiptOperationId: 'receipt-b',
        dateISO: '2026-09-22', dateLabel: '22/09/2026',
      }));
      expect(r2.status).toBe('applied');
      expect(r2.clientes[0].recebimentos).toHaveLength(2);
      expect(r2.clientes[0].pendente).toBe(20);
    });

    it('retry idempotente não executa segunda tx.set financeira', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
            }
          }
        },
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        commitBuffer();
      });

      const input = receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-retry-1',
      });
      const r1 = await applyReceiptDual(input);
      expect(r1.status).toBe('applied');
      expect(r1.clientes[0].recebimentos).toHaveLength(1);
      const firstSetCallCount = tx.set.mock.calls.length;

      const r2 = await applyReceiptDual(input);
      expect(r2.status).toBe('already-applied');
      expect(r2.clientes[0].recebimentos).toHaveLength(1);
      expect(tx.set.mock.calls.length).toBe(firstSetCallCount);
    });

    it('firestore confirma, resposta é perdida e retry reutiliza o mesmo ID', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      let latestSnapshot = existing;
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: latestSnapshot }),
        (entries) => {
          for (const entry of entries) {
            const path = (entry.ref as { _path?: string })._path ?? '';
            if (path.includes('/clients/')) {
              latestSnapshot = (entry.data as { clientes: typeof existing }).clientes;
            }
          }
        },
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        commitBuffer();
      });

      const input = receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-lost-resp',
      });

      const r1 = await applyReceiptDual(input);
      expect(r1.status).toBe('applied');
      expect(r1.clientes[0].recebimentos).toHaveLength(1);
      expect(r1.clientes[0].pendente).toBe(30);

      const r2 = await applyReceiptDual(input);
      expect(r2.status).toBe('already-applied');
      expect(r2.clientes[0].recebimentos).toHaveLength(1);
      expect(r2.clientes[0].pendente).toBe(30);
    });

    it('falha na escrita da entrada financeira também desfaz o recebimento do cliente', async () => {
      const existing = [{
        id: 'c1', nome: 'Ana', pendente: 50,
        contas: [{ id: 'conta-1', saldo: 50, recebido: 0 }],
        recebimentos: [],
      }];
      const { tx, commitBuffer } = makeBufferedTx(
        () => ({ clientes: existing }),
        () => {},
      );
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
        const entries = commitBuffer();
        if (entries.length === 2) {
          throw new Error('Firestore billing write denied');
        }
      });

      await expect(applyReceiptDual(receiptInput({
        clientId: 'c1', valor: 20, receiptOperationId: 'receipt-billing-fail',
      }))).rejects.toThrow('Firestore billing write denied');
    });
  });
});
