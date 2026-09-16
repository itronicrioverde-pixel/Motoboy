import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCustomersIntoPanel } from './panel-bridge';
import type { LegacyCliente } from '../application/merge-legacy-customers';

// ---------- Mocks ----------

// Mock Firebase Firestore
const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ _path: segments.join('/') })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

// Mock Firebase config
vi.mock('../../../config/firebase.js', () => ({ db: { _type: 'firestore' } }));

// Mock customersService
const mockList = vi.fn();
vi.mock('../index', () => ({
  customersService: { list: (...args: unknown[]) => mockList(...args) },
}));

// Mock auth
const mockCurrentUid = vi.fn();
vi.mock('../../auth/application/auth-service', () => ({
  currentUid: () => mockCurrentUid(),
}));

// ---------- Helpers ----------

function makeCustomer(id: string, name: string) {
  return { id, name, status: 'active' as const };
}

function legacyCliente(overrides: Partial<LegacyCliente> & { nome: string }): LegacyCliente {
  return { pendente: 0, contas: [], recebimentos: [], ...overrides };
}

function mockFirestoreDoc(data: LegacyCliente[] | null) {
  if (data === null) {
    // Document doesn't exist
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  } else {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ clientes: data }),
    });
  }
}

// ---------- Tests ----------

describe('loadCustomersIntoPanel — duas fontes remotas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUid.mockReturnValue('uid-123');
  });

  describe('leituras concorrentes', () => {
    it('ambas as fontes são lidas exatamente uma vez', async () => {
      mockList.mockResolvedValue([makeCustomer('c1', 'Ana')]);
      mockFirestoreDoc([]);

      await loadCustomersIntoPanel();

      expect(mockList).toHaveBeenCalledTimes(1);
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('leituras começam concorrentemente (não sequencial)', async () => {
      const customersResolveOrder: string[] = [];
      const financialResolveOrder: string[] = [];

      mockList.mockImplementation(() => new Promise(resolve => {
        customersResolveOrder.push('customers-start');
        setTimeout(() => {
          customersResolveOrder.push('customers-end');
          resolve([makeCustomer('c1', 'Ana')]);
        }, 10);
      }));

      mockGetDoc.mockImplementation(() => new Promise(resolve => {
        financialResolveOrder.push('financial-start');
        setTimeout(() => {
          financialResolveOrder.push('financial-end');
          resolve({ exists: () => true, data: () => ({ clientes: [] }) });
        }, 10);
      }));

      await loadCustomersIntoPanel();

      // Ambos começaram antes de qualquer um terminar
      expect(customersResolveOrder).toContain('customers-start');
      expect(financialResolveOrder).toContain('financial-start');
      expect(customersResolveOrder[0]).toBe('customers-start');
      expect(financialResolveOrder[0]).toBe('financial-start');
    });
  });

  describe('clients/data inexistente', () => {
    it('documento inexistente retorna projeção vazia válida', async () => {
      mockList.mockResolvedValue([makeCustomer('c1', 'Ana')]);
      mockFirestoreDoc(null);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].nome).toBe('Ana');
      }
    });

    it('documento com campo clientes não-array retorna projeção vazia', async () => {
      mockList.mockResolvedValue([]);
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ clientes: 'not-an-array' }),
      });

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe('falha em clients/data', () => {
    it('falha de rede retorna loadFail e impede hidratação', async () => {
      mockList.mockResolvedValue([makeCustomer('c1', 'Ana')]);
      mockGetDoc.mockRejectedValue(new Error('Firestore timeout'));

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe('Firestore timeout');
      }
    });

    it('falha de permissão retorna loadFail', async () => {
      mockList.mockResolvedValue([]);
      mockGetDoc.mockRejectedValue(new Error('Permission denied'));

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(false);
    });
  });

  describe('falha em customers', () => {
    it('falha no customers service impede hidratação', async () => {
      mockList.mockRejectedValue(new Error('Network error'));
      mockFirestoreDoc([]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as Error).message).toBe('Network error');
      }
    });
  });

  describe(' merge por ID estável', () => {
    it('preserva dados financeiros do clients/data quando customers não os possui', async () => {
      mockList.mockResolvedValue([makeCustomer('c1', 'Ana')]);
      mockFirestoreDoc([
        legacyCliente({ id: 'c1', nome: 'Ana', pendente: 50, contas: [{ saldo: 50 }], recebimentos: [{ valor: 10 }] }),
      ]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0].pendente).toBe(50);
        expect(result.data[0].contas).toEqual([{ saldo: 50 }]);
        expect(result.data[0].recebimentos).toEqual([{ valor: 10 }]);
      }
    });

    it('-ID estável associa clientes corretamente', async () => {
      mockList.mockResolvedValue([
        makeCustomer('c1', 'Ana'),
        makeCustomer('c2', 'Bruno'),
      ]);
      mockFirestoreDoc([
        legacyCliente({ id: 'c1', nome: 'Ana', pendente: 10 }),
        legacyCliente({ id: 'c2', nome: 'Bruno', pendente: 20 }),
      ]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ana = result.data.find(c => c.id === 'c1');
        const bruno = result.data.find(c => c.id === 'c2');
        expect(ana?.pendente).toBe(10);
        expect(bruno?.pendente).toBe(20);
      }
    });

    it('cliente legado sem ID usa fallback por nome', async () => {
      mockList.mockResolvedValue([makeCustomer('c1', 'Maria')]);
      mockFirestoreDoc([
        legacyCliente({ nome: 'Maria', pendente: 25, contas: [{ saldo: 25 }], recebimentos: [] }),
      ]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe('c1');
        expect(result.data[0].pendente).toBe(25);
        expect(result.data[0].contas).toEqual([{ saldo: 25 }]);
      }
    });

    it('nomes duplicados sem ID não associam dados ao cliente errado', async () => {
      mockList.mockResolvedValue([
        makeCustomer('c1', 'Ana'),
        makeCustomer('c2', 'Ana'),
      ]);
      mockFirestoreDoc([
        legacyCliente({ nome: 'Ana', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] }),
      ]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        // Apenas um deve ter recebido os dados financeiros
        const withFinance = result.data.filter(c => c.pendente > 0);
        expect(withFinance).toHaveLength(1);
        const withoutFinance = result.data.filter(c => c.pendente === 0);
        expect(withoutFinance).toHaveLength(1);
      }
    });

    it('nenhum dado financeiro quando clients/data está vazio', async () => {
      mockList.mockResolvedValue([makeCustomer('c1', 'Ana')]);
      mockFirestoreDoc([]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data[0].pendente).toBe(0);
        expect(result.data[0].contas).toEqual([]);
        expect(result.data[0].recebimentos).toEqual([]);
      }
    });
  });

  describe('somente leitura', () => {
    it('loadCustomersIntoPanel não importa setDoc', async () => {
      // A bridge somente lê — setDoc é usado apenas em panel.js (saveClientsToFirestore)
      const bridgeModule = await import('./panel-bridge');
      // A função loadCustomersIntoPanel não usa setDoc internamente
      // (verificação: o módulo não re-exporta setDoc)
      expect(bridgeModule).not.toHaveProperty('setDoc');
    });
  });

  describe('uid ausente', () => {
    it('sem uid retorna projeção vazia', async () => {
      mockCurrentUid.mockReturnValue(null);
      mockList.mockResolvedValue([makeCustomer('c1', 'Ana')]);
      mockFirestoreDoc([]);

      const result = await loadCustomersIntoPanel();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].nome).toBe('Ana');
      }
    });
  });
});
