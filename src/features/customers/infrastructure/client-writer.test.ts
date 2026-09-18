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
} from './client-writer';

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
          { operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota · 2 entrega(s)' },
          { operationId: 'r1:svc-bbb', nome: 'Bruno', valor: 30, desc: 'Rota · 1 entrega(s)' },
        ],
        'r1',
      );

      expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });

    it('duas pendências do mesmo cliente são acumuladas', async () => {
      const tx = makeTx();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota · 2 entrega(s)' },
          { operationId: 'r1:svc-bbb', nome: 'Ana', valor: 30, desc: 'Rota · 1 entrega(s)' },
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
          [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
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
          [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
          'r1',
        ),
      ).rejects.toThrow('Sem usuário autenticado.');
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
          { operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'test' },
          { operationId: 'r1:svc-bbb', nome: 'Ana', valor: 30, desc: 'test2' },
        ],
        'r1',
      );

      expect(createdIds.length).toBe(1);
    });

    it('reexecução do callback mantém os mesmos IDs pré-gerados', async () => {
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
      let callCount = 0;
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        callCount++;
        try {
          await fn(tx);
        } catch {
          if (callCount < 2) await fn(tx);
          else throw new Error('Unexpected retry');
        }
      });

      const result = await applyRoutePendingsDual(
        [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'test' }],
        'r1',
      );

      expect(result).toHaveLength(1);
      expect(createdIds.length).toBeGreaterThanOrEqual(1);
    });

    it('ignora pendências com operationId duplicado dentro da mesma transação', async () => {
      const tx = makeTx();
      tx.set = vi.fn();
      mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        await fn(tx);
      });

      const result = await applyRoutePendingsDual(
        [
          { operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'test' },
          { operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'test' },
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
          [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 99, desc: 'new' }],
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
        [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota' }],
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
          [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 99, desc: 'Rota' }],
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
          { operationId: 'r1:svc-aaa', nome: 'Ana', valor: 50, desc: 'Rota' },
          { operationId: 'r1:svc-bbb', nome: 'Bruno', valor: 30, desc: 'Rota' },
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
        [{ operationId: 'r2:svc-aaa', nome: 'Ana', valor: 50, desc: 'Nova rota' }],
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
          [{ operationId: 'r1:svc-aaa', nome: 'Ana', valor: 10, desc: 'test' }],
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
  });
});
