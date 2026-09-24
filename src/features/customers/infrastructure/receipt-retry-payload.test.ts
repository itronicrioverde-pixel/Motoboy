/**
 * Testes de integração do retry de recebimento com o payload original.
 *
 * Cobre o cenário real: a submissão confirma no Firestore mas a resposta se
 * perde (commit seguido de exceção), o cliente é renomeado antes do retry e a
 * reaplicação precisa devolver a mesma entrada já persistida (clientName
 * original, timestamps originais) sem duplicar o saldo nem o faturamento.
 *
 * Componentes reais: ReceiptSubmissionManager + ClientReceiptGateway +
 * LocalStorageReceiptAttemptStore. Firestore é simulado com um store versionado
 * (leitura por snapshot + detecção de conflito + retry de transação), no
 * espírito da runTransaction do Firestore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingReceiptAttempt, ReceiptDraft } from '../application/receipt-submission-manager';
import { createReceiptSubmissionManager } from '../application/receipt-submission-manager';

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

import { createClientReceiptGateway } from './client-receipt-gateway';
import {
  createLocalStorageReceiptAttemptStore,
  receiptAttemptKey,
} from './local-storage-receipt-attempt-store';
import type { ReceiptAttemptStorage } from './local-storage-receipt-attempt-store';

// ---------- Fakes transacionais ----------

interface TxEntry { ref: unknown; data: unknown; options?: unknown; }

function refPath(ref: unknown): string {
  return (ref as { _path?: string })._path ?? '';
}

/**
 * Store transacional com detecção de conflito (espírito do Firestore):
 * cada transação lê um snapshot; o commit só aplica se nenhum caminho escrito
 * tiver sido alterado desde o snapshot. Em conflito retorna false e a
 * "aplicação" repete o callback com snapshot novo.
 */
function createVersionedStore(seed: Record<string, unknown> = {}) {
  interface DocState { data: unknown; version: number; }
  const docs = new Map<string, DocState>();
  for (const [path, data] of Object.entries(seed)) {
    docs.set(path, { data, version: 1 });
  }

  function createTransaction() {
    const snapshot = new Map<string, DocState>();
    for (const [path, state] of docs) {
      snapshot.set(path, { data: state.data, version: state.version });
    }
    const buffer: TxEntry[] = [];
    const tx = {
      get: vi.fn(async (ref: unknown) => {
        const state = snapshot.get(refPath(ref));
        return { exists: () => state !== undefined, data: () => state?.data };
      }),
      set: vi.fn((ref: unknown, data: unknown, options?: unknown) => {
        buffer.push({ ref, data, options });
      }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    function commit(): boolean {
      for (const entry of buffer) {
        const path = refPath(entry.ref);
        const readVersion = snapshot.get(path)?.version ?? 0;
        const currentVersion = docs.get(path)?.version ?? 0;
        if (readVersion !== currentVersion) return false;
      }
      for (const entry of buffer) {
        const path = refPath(entry.ref);
        docs.set(path, {
          data: entry.data,
          version: (docs.get(path)?.version ?? 0) + 1,
        });
      }
      return true;
    }
    return { tx, commit };
  }

  function setData(path: string, data: unknown) {
    docs.set(path, { data, version: (docs.get(path)?.version ?? 0) + 1 });
  }

  return { docs, createTransaction, setData };
}

type VersionedStore = ReturnType<typeof createVersionedStore>;

/**
 * Instala a simulação de runTransaction sobre o store versionado.
 * Exceções lançadas DENTRO do callback abortam a transação (nenhum commit).
 * `commitThenThrow` retorna true quando uma invocação já confirmada deve
 * lançar (simula resposta perdida na rede após o commit do Firestore).
 */
function installRunTransaction(
  versioned: VersionedStore,
  options: { commitThenThrow?: (invocation: number) => boolean } = {},
) {
  let invocation = 0;
  mocks.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
    for (;;) {
      const txn = versioned.createTransaction();
      await fn(txn.tx);
      invocation += 1;
      if (options.commitThenThrow?.(invocation)) {
        txn.commit();
        throw new Error('resposta perdida na rede');
      }
      if (txn.commit()) return;
    }
  });
}

// ---------- Cena base ----------

function makeClient(nome: string, pendente = 50) {
  return {
    id: 'c1',
    nome,
    pendente,
    contas: [{ id: 'conta-1', saldo: pendente, recebido: 0, status: 'open' }],
    recebimentos: [] as unknown[],
  };
}

function seedClients(versioned: VersionedStore, client: ReturnType<typeof makeClient>) {
  versioned.setData('users/uid-1/clients/data', { clientes: [client] });
}

function makeDraft(overrides: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return {
    clientId: 'c1',
    clientName: 'Ana',
    valor: 20,
    dateISO: '2026-09-21',
    dateLabel: '21/09/2026',
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

function makeHarness(backend: ReturnType<typeof makeFakeStorage>) {
  const store = createLocalStorageReceiptAttemptStore(backend.storage);
  const gateway = createClientReceiptGateway();
  const manager = createReceiptSubmissionManager({
    currentUid: () => mockCurrentUid(),
    generateReceiptOperationId: () => 'receipt-rename-1',
    store,
    gateway,
  });
  return { manager, store, gateway, backend };
}

function renameClient(versioned: VersionedStore, novoNome: string) {
  const current = versioned.docs.get('users/uid-1/clients/data')!.data as {
    clientes: Array<ReturnType<typeof makeClient>>;
  };
  versioned.setData('users/uid-1/clients/data', {
    clientes: current.clientes.map((c) => ({ ...c, nome: novoNome })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentUid.mockReturnValue('uid-1');
});

// ---------- Testes ----------

describe('receipt retry preserva o payload original', () => {
  it('resposta perdida + renomeação do cliente: retry devolve a entrada persistida com nome e timestamps originais', async () => {
    const versioned = createVersionedStore();
    seedClients(versioned, makeClient('Ana'));
    installRunTransaction(versioned, { commitThenThrow: (i) => i === 1 });
    const { manager } = makeHarness(makeFakeStorage());

    const entradaRef = 'users/uid-1/entradas/receipt-rename-1';

    // 1ª tentativa: confirma no Firestore (commit), mas a resposta se perde.
    await expect(manager.submit(makeDraft())).rejects.toThrow('resposta perdida na rede');
    expect(manager.getState().status).toBe('failed');

    const entryAfterFirstCommit = versioned.docs.get(entradaRef)!.data as {
      clientName: string;
      createdAt: number;
    };
    expect(entryAfterFirstCommit.clientName).toBe('Ana');

    // O cliente é renomeado no meio do caminho (antes do retry).
    renameClient(versioned, 'Ana Maria');

    const result = await manager.retry();
    expect(result.status).toBe('already-applied');
    // Nome e timestamps do payload imutável original, não os do cadastro atual.
    expect(result.billingEntry.clientName).toBe('Ana');
    expect(result.billingEntry.desc).toBe('Recebimento de Ana');
    expect(result.billingEntry.createdAt).toBe(entryAfterFirstCommit.createdAt);
    expect(result.billingEntry.updatedAt).toBe(entryAfterFirstCommit.createdAt);
    // Cadastro atual segue com o nome novo; saldo NÃO reduziu uma segunda vez.
    expect(result.clientes[0].nome).toBe('Ana Maria');
    expect(result.clientes[0].pendente).toBe(30);
    expect(result.clientes[0].recebimentos).toHaveLength(1);
    // A entrada financeira continua escrita exatamente uma vez (escrita única).
    expect(versioned.docs.get(entradaRef)!.version).toBe(1);
  });

  it('resposta perdida + renomeação: novo manager que recarrega do mesmo storage mantém o clientName original no retry', async () => {
    const versioned = createVersionedStore();
    seedClients(versioned, makeClient('Ana'));
    installRunTransaction(versioned, { commitThenThrow: (i) => i === 1 });
    const backend = makeFakeStorage();
    const first = makeHarness(backend);

    await expect(first.manager.submit(makeDraft())).rejects.toThrow('resposta perdida na rede');
    renameClient(versioned, 'Ana Maria');

    // Recarga: o usuário reinicia a página e um novo manager+gateway usam o
    // MESMO armazenamento local físico; a tentativa persistida reaparece.
    const reloaded = makeHarness(backend);
    const pending = reloaded.manager.loadPending();
    expect(pending).not.toBeNull();
    expect(pending!.clientName).toBe('Ana');

    const result = await reloaded.manager.retry();
    expect(result.status).toBe('already-applied');
    expect(result.billingEntry.clientName).toBe('Ana');
    expect(result.clientes[0].nome).toBe('Ana Maria');
    expect(result.clientes[0].pendente).toBe(30);
  });

  it('renomeação já ocorrida antes do retry: o payload gravado usa o nome original da submissão', async () => {
    const versioned = createVersionedStore();
    // O cliente já foi renomeado no cadastro antes de a submissão chegar ao gateway.
    seedClients(versioned, makeClient('Ana Maria'));
    installRunTransaction(versioned, { commitThenThrow: (i) => i === 1 });
    const { manager } = makeHarness(makeFakeStorage());

    await expect(manager.submit(makeDraft())).rejects.toThrow('resposta perdida na rede');
    const entry = versioned.docs.get('users/uid-1/entradas/receipt-rename-1')!.data as {
      clientName: string;
      desc: string;
    };
    // O payload imutável gravado no Firestore é o nome da submissão original.
    expect(entry.clientName).toBe('Ana');
    expect(entry.desc).toBe('Recebimento de Ana');
  });

  it('payload financeiro diferente mantém conflito mesmo com clientName preservado', async () => {
    const versioned = createVersionedStore();
    // Recebimento de 20 já confirmado anteriormente (saldo 50 → 30).
    seedClients(versioned, {
      ...makeClient('Ana', 30),
      recebimentos: [{ receiptOperationId: 'receipt-rename-1', valor: 20 }],
    });
    versioned.setData('users/uid-1/entradas/receipt-rename-1', {
      receiptOperationId: 'receipt-rename-1',
      source: 'client_receipt',
      clientId: 'c1',
      clientName: 'Ana',
      desc: 'Recebimento de Ana',
      valor: 20,
      data: '21/09/2026',
      dateISO: '2026-09-21',
      createdAt: 111,
      updatedAt: 222,
    });
    installRunTransaction(versioned);
    const { manager } = makeHarness(makeFakeStorage());

    // Mesmo clientName preservado, mas valor diferente do já aplicado → conflito.
    await expect(manager.submit(makeDraft({ valor: 25 }))).rejects.toThrow(/Conflito de receiptOperationId/);
    expect(manager.getState().status).toBe('failed');

    // Nada foi sobrescrito: pendente permanece 30, histórico único e entrada intacta.
    const clientsAfter = (
      versioned.docs.get('users/uid-1/clients/data')!.data as {
        clientes: Array<{ pendente: number; recebimentos: unknown[] }>;
      }
    ).clientes;
    expect(clientsAfter[0].pendente).toBe(30);
    expect(clientsAfter[0].recebimentos).toHaveLength(1);
    expect(versioned.docs.get('users/uid-1/entradas/receipt-rename-1')!.data).toMatchObject({
      receiptOperationId: 'receipt-rename-1',
      clientName: 'Ana',
      valor: 20,
    });
  });

  it('tentativa antiga SEM clientName continua válida: fallback para o nome atual do cliente', async () => {
    const versioned = createVersionedStore();
    seedClients(versioned, makeClient('Ana Maria'));
    installRunTransaction(versioned);
    const backend = makeFakeStorage();
    const { manager } = makeHarness(backend);

    // Dados antigos gravados antes da introdução do clientName (sem o campo).
    const legacyAttempt: PendingReceiptAttempt = {
      uid: 'uid-1',
      receiptOperationId: 'receipt-legacy-1',
      clientId: 'c1',
      valor: 20,
      dateISO: '2026-09-21',
      dateLabel: '21/09/2026',
      createdAt: 1,
    };
    backend.items.set(receiptAttemptKey('uid-1'), JSON.stringify(legacyAttempt));

    const pending = manager.loadPending();
    expect(pending).not.toBeNull();
    expect(pending!.clientName).toBeUndefined();

    const result = await manager.retry();
    expect(result.status).toBe('applied');
    // Sem nome preservado, o cadastro atual é usado como fallback (comportamento legado).
    expect(result.billingEntry.clientName).toBe('Ana Maria');
    expect(result.billingEntry.desc).toBe('Recebimento de Ana Maria');
    expect(result.clientes[0].pendente).toBe(30);
  });

  it('resposta perdida + tentativa antiga (sem clientName) + renomeação: retry valida cliente/valor/data/origem e devolve a entrada persistida', async () => {
    const versioned = createVersionedStore();
    seedClients(versioned, makeClient('Ana'));
    installRunTransaction(versioned, { commitThenThrow: (i) => i === 1 });
    const { manager } = makeHarness(makeFakeStorage());

    const entradaRef = 'users/uid-1/entradas/receipt-rename-1';

    // Tentativa gravada por uma versão antiga do painel: SEM clientName.
    const legacyDraft: ReceiptDraft = {
      clientId: 'c1',
      valor: 20,
      dateISO: '2026-09-21',
      dateLabel: '21/09/2026',
    };

    // 1ª tentativa: confirmou no Firestore (entrada gravada com o nome vigente
    // "Ana") e a resposta se perdeu.
    await expect(manager.submit(legacyDraft)).rejects.toThrow('resposta perdida na rede');
    const firstEntry = versioned.docs.get(entradaRef)!.data as {
      clientName: string;
      createdAt: number;
      updatedAt: number;
    };
    expect(firstEntry.clientName).toBe('Ana');

    // Renomeação do cadastro antes do retry.
    renameClient(versioned, 'Ana Maria');

    const pending = manager.loadPending();
    expect(pending).not.toBeNull();
    expect(pending!.clientName).toBeUndefined();

    const result = await manager.retry();
    expect(result.status).toBe('already-applied');
    // Sem clientName, nome/desc não são comparados: valida-se cliente, valor,
    // data e origem; o NOME e os timestamps da entrada persistida prevalecem.
    expect(result.billingEntry.clientName).toBe('Ana');
    expect(result.billingEntry.desc).toBe('Recebimento de Ana');
    expect(result.billingEntry.createdAt).toBe(firstEntry.createdAt);
    expect(result.billingEntry.updatedAt).toBe(firstEntry.updatedAt);
    // Sem nova escrita: entrada única e saldo/histórico inalterados.
    expect(versioned.docs.get(entradaRef)!.version).toBe(1);
    expect(result.clientes[0].nome).toBe('Ana Maria');
    expect(result.clientes[0].pendente).toBe(30);
    expect(result.clientes[0].recebimentos).toHaveLength(1);
  });
});
