import { describe, it, expect, vi } from 'vitest';
import { createReceiptSubmissionManager } from './receipt-submission-manager';
import type {
  ApplyReceiptResult,
  PendingReceiptAttempt,
  PendingReceiptStore,
  ReceiptGateway,
  ReceiptSubmissionManagerDependencies,
} from './receipt-submission-manager';

// ---------- Fakes ----------

function makeDraft(overrides: Partial<{ clientId: string; clientName: string; valor: number; dateISO: string; dateLabel: string }> = {}) {
  return {
    clientId: 'c1',
    clientName: 'Ana',
    valor: 30,
    dateISO: '2026-09-23',
    dateLabel: 'Hoje',
    ...overrides,
  };
}

function makeBilling(attempt: PendingReceiptAttempt) {
  return {
    receiptOperationId: attempt.receiptOperationId,
    source: 'client_receipt' as const,
    clientId: attempt.clientId ?? null,
    clientName: attempt.legacyLookupName ?? 'Cliente Teste',
    desc: 'Recebimento',
    valor: attempt.valor,
    data: '23/09/2026',
    dateISO: attempt.dateISO,
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeResult(attempt: PendingReceiptAttempt): ApplyReceiptResult {
  return {
    clientes: [
      {
        id: attempt.clientId,
        nome: attempt.legacyLookupName ?? 'Cliente Teste',
        pendente: 0,
        contas: [],
        recebimentos: [{ receiptOperationId: attempt.receiptOperationId, valor: attempt.valor }],
      },
    ],
    billingEntry: makeBilling(attempt),
    receiptOperationId: attempt.receiptOperationId,
    status: 'applied',
  };
}

function makeFakeStore(log?: string[]) {
  const data = new Map<string, PendingReceiptAttempt>();
  const store: PendingReceiptStore = {
    load(uid) {
      return data.get(uid) ?? null;
    },
    save(attempt) {
      if (log) log.push('save');
      data.set(attempt.uid, attempt);
    },
    clear(uid, receiptOperationId) {
      if (log) log.push('clear');
      const current = data.get(uid);
      if (current && current.uid === uid && current.receiptOperationId === receiptOperationId) {
        data.delete(uid);
      }
    },
  };
  return { store, data };
}

interface HarnessOptions {
  uid?: string | null;
  uidSequence?: string[];
  uidRef?: { current: string | null };
  generator?: () => string;
  store?: PendingReceiptStore;
  gateway?: unknown;
}

function makeHarness(options: HarnessOptions = {}) {
  const log: string[] = [];
  const uid = options.uid === undefined ? 'user-1' : options.uid;
  let uidCalls = 0;
  const fake = makeFakeStore(log);
  const store = options.store ?? fake.store;
  const data = fake.data;
  const applyFn =
    options.gateway ??
    vi.fn(async (attempt: PendingReceiptAttempt) => {
      log.push('apply');
      return makeResult(attempt);
    });
  const gateway = { apply: applyFn } as ReceiptGateway;

  const dependencies: ReceiptSubmissionManagerDependencies = {
    currentUid: () => {
      if (options.uidRef) return options.uidRef.current;
      if (options.uidSequence && uidCalls < options.uidSequence.length) {
        return options.uidSequence[uidCalls++];
      }
      return uid;
    },
    generateReceiptOperationId: options.generator ?? (() => 'receipt-abc123'),
    store,
    gateway,
  };

  const manager = createReceiptSubmissionManager(dependencies);
  return { manager, gateway: applyFn as ReturnType<typeof vi.fn>, log, data };
}

// ---------- Testes ----------

describe('createReceiptSubmissionManager', () => {
  it('#1 primeira submissão gera um único receiptOperationId persistido e repassado ao gateway', async () => {
    const { manager, gateway, data } = makeHarness();
    const result = await manager.submit(makeDraft());

    expect(gateway).toHaveBeenCalledTimes(1);
    const attemptArg = gateway.mock.calls[0][0] as PendingReceiptAttempt;
    expect(attemptArg.receiptOperationId).toBe('receipt-abc123');
    expect(attemptArg.clientId).toBe('c1');
    expect(attemptArg.clientName).toBe('Ana');
    expect(attemptArg.valor).toBe(30);
    expect(attemptArg.dateISO).toBe('2026-09-23');
    expect(data.get('user-1')).toBeUndefined();
    expect(result.status).toBe('applied');
    expect(manager.getState().status).toBe('idle');
  });

  it('#1b retry preserva o clientName da submissão original', async () => {
    const gateway = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { manager } = makeHarness({ gateway });

    await expect(manager.submit(makeDraft({ clientName: 'Ana' }))).rejects.toThrow('offline');
    await manager.retry();

    expect(gateway).toHaveBeenCalledTimes(2);
    const originalArg = gateway.mock.calls[0][0] as PendingReceiptAttempt;
    const retryArg = gateway.mock.calls[1][0] as PendingReceiptAttempt;
    expect(originalArg.clientName).toBe('Ana');
    expect(retryArg.clientName).toBe('Ana');
    expect(retryArg.receiptOperationId).toBe('receipt-abc123');
  });

  it('#2 lock: submissões concorrentes retornam a mesma Promise', async () => {
    let resolveApply!: (v: ApplyReceiptResult) => void;
    let attemptHolder: PendingReceiptAttempt | null = null;
    const gateway = vi.fn(
      (attempt: PendingReceiptAttempt) =>
        new Promise<ApplyReceiptResult>((resolve) => {
          attemptHolder = attempt;
          resolveApply = resolve;
        }),
    );
    const { manager } = makeHarness({ gateway });

    const p1 = manager.submit(makeDraft());
    const p2 = manager.submit(makeDraft());

    expect(p2).toBe(p1);
    resolveApply(makeResult(attemptHolder!));
    const result = await p1;
    expect(await p2).toBe(result);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it('#3 falha ao persistir impede a chamada ao gateway', async () => {
    const throwingStore: PendingReceiptStore = {
      load: () => null,
      save: () => {
        throw new Error('quota excedida');
      },
      clear: () => {},
    };
    const gateway = vi.fn(async () => makeResult({} as PendingReceiptAttempt));
    const { manager } = makeHarness({ store: throwingStore, gateway });

    expect(() => manager.submit(makeDraft())).toThrow('quota excedida');
    expect(gateway).not.toHaveBeenCalled();
  });

  it('#4 persistência acontece antes da chamada ao gateway', async () => {
    const { manager, log } = makeHarness();
    await manager.submit(makeDraft());
    expect(log.filter((c) => c === 'save').length).toBe(1);
    expect(log.indexOf('save')).toBeLessThan(log.indexOf('apply'));
  });

  it('#5 falha do gateway lança o erro e mantém a tentativa com o mesmo receiptOperationId', async () => {
    const error = new Error('rede indisponível');
    const gateway = vi.fn(async () => {
      throw error;
    });
    const { manager, data } = makeHarness({ gateway });

    await expect(manager.submit(makeDraft())).rejects.toBe(error);
    expect(manager.getState().status).toBe('failed');
    expect(data.get('user-1')).not.toBeUndefined();
    expect(data.get('user-1')!.receiptOperationId).toBe('receipt-abc123');
  });

  it('#6 sucesso applied limpa a tentativa e volta a idle', async () => {
    const { manager, data } = makeHarness();
    await manager.submit(makeDraft());
    expect(data.size).toBe(0);
    expect(manager.getState().status).toBe('idle');
  });

  it('#7 already-applied também limpa a tentativa sem lançar', async () => {
    const attempt = { uid: 'user-1', receiptOperationId: 'receipt-abc123' } as PendingReceiptAttempt;
    const gateway = vi.fn(async () => ({ ...makeResult(attempt), status: 'already-applied' as const }));
    const { manager, data } = makeHarness({ gateway });
    await manager.submit(makeDraft());
    expect(data.size).toBe(0);
    expect(manager.getState().status).toBe('idle');
  });

  it('#8 novo submit com tentativa pendente (mesmo payload) é rejeitado', async () => {
    const { manager, data } = makeHarness({ generator: () => 'receipt-pending' });
    data.set('user-1', {
      uid: 'user-1',
      receiptOperationId: 'receipt-pending',
      clientId: 'c1',
      valor: 30,
      dateISO: '2026-09-23',
      dateLabel: 'Hoje',
      createdAt: 1,
    });
    expect(() => manager.submit(makeDraft())).toThrow(/pendente/);
  });

  it('#9 novo submit com payload diferente é rejeitado — nada é descartado silenciosamente', async () => {
    const { manager, data } = makeHarness({ generator: () => 'receipt-pending' });
    data.set('user-1', {
      uid: 'user-1',
      receiptOperationId: 'receipt-pending',
      clientId: 'c1',
      valor: 10,
      dateISO: '2026-09-23',
      dateLabel: 'Hoje',
      createdAt: 1,
    });
    expect(() => manager.submit(makeDraft({ valor: 50 }))).toThrow(/pendente/);
    expect(data.get('user-1')!.receiptOperationId).toBe('receipt-pending');
  });

  it('#10 retry após falha conserva o mesmo receiptOperationId', async () => {
    const gateway = vi
      .fn()
      .mockRejectedValueOnce(new Error('rede indisponível'))
      .mockImplementation(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { manager } = makeHarness({ gateway });

    await expect(manager.submit(makeDraft())).rejects.toThrow('rede indisponível');
    await manager.retry();

    expect(gateway).toHaveBeenCalledTimes(2);
    const retryArg = gateway.mock.calls[1][0] as PendingReceiptAttempt;
    expect(retryArg.receiptOperationId).toBe('receipt-abc123');
    expect(retryArg.valor).toBe(30);
  });

  it('#11 retry reutiliza o payload persistido e reaplica com sucesso', async () => {
    const gateway = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { manager } = makeHarness({ gateway });

    await expect(manager.submit(makeDraft())).rejects.toThrow('offline');
    const result = await manager.retry();

    expect(result.status).toBe('applied');
    expect(manager.getState().status).toBe('idle');
    expect(manager.loadPending()).toBeNull();
  });

  it('#12 erro de recebimento pendente menciona pendente e retentativa', async () => {
    const gateway = vi.fn(async () => {
      throw new Error('offline');
    });
    const { manager } = makeHarness({ gateway });
    await expect(manager.submit(makeDraft())).rejects.toThrow('offline');
    try {
      manager.submit(makeDraft());
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('pendente');
      expect(message).toContain('Retentar recebimento');
    }
  });

  it('#13 estado inFlight durante a execução', async () => {
    let resolveApply!: (v: ApplyReceiptResult) => void;
    let attemptHolder: PendingReceiptAttempt | null = null;
    const gateway = vi.fn(
      (attempt: PendingReceiptAttempt) =>
        new Promise<ApplyReceiptResult>((resolve) => {
          attemptHolder = attempt;
          resolveApply = resolve;
        }),
    );
    const { manager } = makeHarness({ gateway });

    const promise = manager.submit(makeDraft());
    const state = manager.getState();
    expect(state.status).toBe('inFlight');
    if (state.status === 'inFlight') {
      expect(state.attempt.receiptOperationId).toBe('receipt-abc123');
    }
    resolveApply(makeResult(attemptHolder!));
    await promise;
  });

  it('#14 lock compartilhado: retry durante inFlight retorna a MESMA Promise da submissão', async () => {
    let resolveApply!: (v: ApplyReceiptResult) => void;
    let attemptHolder: PendingReceiptAttempt | null = null;
    const gateway = vi.fn(
      (attempt: PendingReceiptAttempt) =>
        new Promise<ApplyReceiptResult>((resolve) => {
          attemptHolder = attempt;
          resolveApply = resolve;
        }),
    );
    const { manager } = makeHarness({ gateway });

    const p1 = manager.submit(makeDraft());
    const p2 = manager.retry();
    expect(p2).toBe(p1);
    resolveApply(makeResult(attemptHolder!));
    await p1;
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it('#15 mudança de UID durante execução lança erro de sessão alterada, não limpa a tentativa e o estado vira idle', async () => {
    const uidRef = { current: 'user-1' };
    const { manager, data } = makeHarness({ uidRef });
    // A troca acontece no mesmo tick em que a promessa do gateway é encaminhada,
    // simulando a troca de sessão durante a operação em voo.
    const promise = manager.submit(makeDraft());
    uidRef.current = 'user-2';
    await expect(promise).rejects.toThrow('Sessão alterada');
    expect(data.get('user-1')).not.toBeUndefined();
    expect(data.get('user-1')!.receiptOperationId).toBe('receipt-abc123');
    // A conta que mudou de sessão não pode enxergar a tentativa da conta anterior.
    expect(manager.getState().status).toBe('idle');
  });

  it('#16 retry sem tentativa persistida lança erro e manager fica idle', async () => {
    const { manager } = makeHarness();
    expect(() => manager.retry()).toThrow('Não existe recebimento pendente');
    expect(manager.getState().status).toBe('idle');
  });

  it('#17 JSON corrompido no store não quebra o manager', async () => {
    const corruptStore: PendingReceiptStore = {
      load: () => {
        throw new Error('JSON inválido');
      },
      save: () => {},
      clear: () => {},
    };
    const gateway = vi.fn(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { manager } = makeHarness({ store: corruptStore, gateway });

    const result = await manager.submit(makeDraft());
    expect(result.status).toBe('applied');
  });

  it('#18 tentativa com formato inválido (load) é ignorada com segurança', async () => {
    const invalidStore: PendingReceiptStore = {
      load: () => {
        throw new Error('formato inválido');
      },
      save: () => {},
      clear: () => {},
    };
    const { manager } = makeHarness({ store: invalidStore });
    expect(manager.loadPending()).toBeNull();
    expect(manager.getState().status).toBe('idle');
  });

  it('#19 após falha, novo submit é rejeitado — tentativa preservada para retry', async () => {
    const gateway = vi.fn(async () => {
      throw new Error('offline');
    });
    const { manager, data } = makeHarness({ gateway, generator: () => 'receipt-initial' });

    await expect(manager.submit(makeDraft())).rejects.toThrow('offline');
    expect(() => manager.submit(makeDraft())).toThrow('pendente');
    expect(data.get('user-1')!.receiptOperationId).toBe('receipt-initial');
  });

  it('#20 gerador de UUID é chamado somente na criação inicial', async () => {
    const generator = vi.fn(() => 'receipt-only-once');
    const gateway = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { manager } = makeHarness({ generator, gateway });

    await expect(manager.submit(makeDraft())).rejects.toThrow('offline');
    await manager.retry();
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it('#21 troca de sessão descarta o estado em memória, não expõe dados de A para B e A recupera a própria tentativa ao voltar', async () => {
    const uidRef = { current: 'user-1' };
    const gateway = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { manager, data } = makeHarness({ uidRef, gateway });

    // A tenta registrar e falha: tentativa fica pendente na chave de A.
    await expect(manager.submit(makeDraft())).rejects.toThrow('offline');
    expect(manager.getState().status).toBe('failed');
    expect(data.get('user-1')).not.toBeUndefined();
    expect(data.get('user-1')!.uid).toBe('user-1');

    // Troca de sessão para B: mesmo sem qualquer ação, getState não expõe dados de A.
    uidRef.current = 'user-2';
    expect(manager.getState()).toEqual({ status: 'idle' });

    // B carrega a própria tentativa: não existe nada pendente para B.
    expect(manager.loadPending()).toBeNull();
    expect(manager.getState().status).toBe('idle');

    // A tentativa de A continua persistida na chave de A (nada foi apagado).
    expect(data.get('user-1')).not.toBeUndefined();
    expect(data.get('user-2')).toBeUndefined();

    // B pode registrar um recebimento próprio sem interferir na tentativa de A.
    await manager.submit(makeDraft({ valor: 15, clientId: 'c-b' }));
    expect(gateway).toHaveBeenCalledTimes(2);
    expect((gateway.mock.calls[1][0] as PendingReceiptAttempt).uid).toBe('user-2');
    expect(data.get('user-1')).not.toBeUndefined();
    expect(data.get('user-2')).toBeUndefined();

    // A volta: recupera exatamente a própria tentativa, com o mesmo receiptOperationId.
    uidRef.current = 'user-1';
    const pending = manager.loadPending();
    expect(pending).not.toBeNull();
    expect(pending!.uid).toBe('user-1');
    expect(pending!.receiptOperationId).toBe('receipt-abc123');
    expect(manager.getState()).toEqual({ status: 'pending', attempt: pending });
  });

  it('#22 troca de sessão com tentativa em voo não deixa o retorno da conta anterior poluir o estado de B', async () => {
    let resolveApply!: (v: ApplyReceiptResult) => void;
    let attemptHolder: PendingReceiptAttempt | null = null;
    const gateway = vi.fn(
      (attempt: PendingReceiptAttempt) =>
        new Promise<ApplyReceiptResult>((resolve) => {
          attemptHolder = attempt;
          resolveApply = resolve;
        }),
    );
    const uidRef = { current: 'user-1' };
    const { manager } = makeHarness({ uidRef, gateway });

    const promise = manager.submit(makeDraft());
    expect(manager.getState().status).toBe('inFlight');

    // Sessão muda para B enquanto a operação de A ainda está em voo.
    uidRef.current = 'user-2';
    expect(manager.getState().status).toBe('idle');

    // A operação de A termina: erro de sessão alterada, e B continua vendo idle.
    resolveApply(makeResult(attemptHolder!));
    await expect(promise).rejects.toThrow('Sessão alterada');
    expect(manager.getState().status).toBe('idle');
  });
});