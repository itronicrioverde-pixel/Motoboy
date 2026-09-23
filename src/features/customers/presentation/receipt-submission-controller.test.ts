import { describe, it, expect, vi } from 'vitest';
import { createReceiptSubmissionController } from './receipt-submission-controller';
import { createReceiptSubmissionManager } from '../application/receipt-submission-manager';
import type {
  ApplyReceiptResult,
  PendingReceiptAttempt,
  PendingReceiptStore,
  ReceiptGateway,
  ReceiptSubmissionManagerDependencies,
} from '../application/receipt-submission-manager';

// ---------- Fakes ----------

function makeDraft(overrides: Partial<{ clientId: string; valor: number; dateISO: string; dateLabel: string }> = {}) {
  return {
    clientId: 'c1',
    valor: 30,
    dateISO: '2026-09-23',
    dateLabel: 'Hoje',
    ...overrides,
  };
}

function makeResult(attempt: PendingReceiptAttempt): ApplyReceiptResult {
  return {
    clientes: [
      {
        id: attempt.clientId,
        nome: 'Cliente Teste',
        pendente: 0,
        contas: [],
        recebimentos: [{ receiptOperationId: attempt.receiptOperationId, valor: attempt.valor }],
      },
    ],
    billingEntry: {
      receiptOperationId: attempt.receiptOperationId,
      source: 'client_receipt' as const,
      clientId: attempt.clientId ?? null,
      clientName: 'Cliente Teste',
      desc: 'Recebimento',
      valor: attempt.valor,
      data: '23/09/2026',
      dateISO: attempt.dateISO,
      createdAt: 1,
      updatedAt: 2,
    },
    receiptOperationId: attempt.receiptOperationId,
    status: 'applied',
  };
}

function makeFakeStore() {
  const data = new Map<string, PendingReceiptAttempt>();
  const store: PendingReceiptStore = {
    load(uid) {
      return data.get(uid) ?? null;
    },
    save(attempt) {
      data.set(attempt.uid, attempt);
    },
    clear(uid, receiptOperationId) {
      const current = data.get(uid);
      if (current && current.uid === uid && current.receiptOperationId === receiptOperationId) {
        data.delete(uid);
      }
    },
  };
  return { store, data };
}

interface Harness {
  controller: ReturnType<typeof createReceiptSubmissionController>;
  manager: ReturnType<typeof createReceiptSubmissionManager>;
  apply: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
  data: Map<string, PendingReceiptAttempt>;
  resolveApply: (value: ApplyReceiptResult) => void;
}

function makeHarness(options: { uidRef?: { current: string | null }; applyImpl?: ReturnType<typeof vi.fn> } = {}): Harness {
  const uidRef = options.uidRef ?? { current: 'user-1' };
  const { store, data } = makeFakeStore();
  let pendingResolve: ((value: ApplyReceiptResult) => void) | null = null;
  const apply =
    options.applyImpl ??
    vi.fn(
      (_attempt: PendingReceiptAttempt) =>
        new Promise<ApplyReceiptResult>((resolve) => {
          pendingResolve = resolve;
        }),
    );
  const gateway = { apply } as ReceiptGateway;
  const dependencies: ReceiptSubmissionManagerDependencies = {
    currentUid: () => uidRef.current,
    generateReceiptOperationId: () => 'receipt-abc123',
    store,
    gateway,
  };
  const manager = createReceiptSubmissionManager(dependencies);
  const commit = vi.fn();
  const fail = vi.fn();
  const interactive = vi.fn(() => true);
  const controller = createReceiptSubmissionController(manager, {
    commit,
    fail,
    isInteractive: interactive,
  });
  // Lê a referência viva de pendingResolve (propriedade copiada ficaria com o valor stale).
  const resolveApply = (value: ApplyReceiptResult): void => {
    const resolver = pendingResolve;
    if (!resolver) throw new Error('resolveApply chamado sem submissão pendente.');
    resolver(value);
  };
  return { controller, manager, apply, commit, fail, data, resolveApply };
}

// ---------- Testes ----------

describe('createReceiptSubmissionController', () => {
  it('#1 clique com Promise pendente + clique repetido → gateway uma vez, commit uma vez (clientes/billing/toast/modal uma única vez)', async () => {
    const { controller, apply, commit, fail, resolveApply } = makeHarness();

    const p1 = controller.submit(makeDraft());
    const p2 = controller.submit(makeDraft());
    const p3 = controller.retry();

    // Deixa o microtask do gateway rodar antes de contar.
    await Promise.resolve();

    // Lock: enquanto a primeira submissão está pendente, cliques são ignorados.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);

    resolveApply(makeResult({ uid: 'user-1', receiptOperationId: 'receipt-abc123', valor: 30 } as PendingReceiptAttempt));
    await p1;

    // Confirmação acontece exatamente uma vez; nada é aplicado em duplicata.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(controller.isRunning()).toBe(false);
  });

  it('#2 falha mantém o modal aberto (sem commit) e o estado vira pendingAttempt para o botão "Retentar recebimento"', async () => {
    const { controller, apply, commit, fail } = makeHarness({
      applyImpl: vi.fn(async () => {
        throw new Error('rede indisponível');
      }),
    });

    await controller.submit(makeDraft());

    expect(apply).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledTimes(1);
    // O painel usa pendingAttempt() para ativar o "Retentar recebimento" mantendo o modal aberto.
    const attempt = controller.pendingAttempt();
    expect(attempt).not.toBeNull();
    expect(attempt!.receiptOperationId).toBe('receipt-abc123');
  });

  it('#3 retry após falha reutiliza o mesmo receiptOperationId e confirma uma vez', async () => {
    const apply = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (attempt: PendingReceiptAttempt) => makeResult(attempt));
    const { controller, commit, fail } = makeHarness({ applyImpl: apply });

    await controller.submit(makeDraft());
    expect(fail).toHaveBeenCalledTimes(1);

    await controller.retry();

    expect(apply).toHaveBeenCalledTimes(2);
    const submitArg = apply.mock.calls[0][0] as PendingReceiptAttempt;
    const retryArg = apply.mock.calls[1][0] as PendingReceiptAttempt;
    expect(retryArg.receiptOperationId).toBe(submitArg.receiptOperationId);
    expect(retryArg.receiptOperationId).toBe('receipt-abc123');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.isRunning()).toBe(false);
  });

  it('#4 tentativa do cliente A impede abertura incoerente para B na mesma sessão', async () => {
    const { controller, commit, fail } = makeHarness({
      applyImpl: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    // A falha deixa uma tentativa pendente (cliente c1).
    await controller.submit(makeDraft({ clientId: 'c1', valor: 80 }));
    expect(fail).toHaveBeenCalledTimes(1);

    // Abrir o modal para o cliente c2 passa por pendingAttempt(): como há tentativa
    // pendente, o painel entra em modo de retomada (nunca um rascunho novo incoerente).
    const pending = controller.pendingAttempt();
    expect(pending).not.toBeNull();
    expect(pending!.clientId).toBe('c1');

    // E um novo submit com outro cliente é recusado: nada é descartado silenciosamente.
    await controller.submit(makeDraft({ clientId: 'c2', valor: 50 }));
    expect(fail).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
  });

  it('#5 troca para outra conta não expõe a tentativa da conta anterior', async () => {
    const uidRef = { current: 'user-1' };
    const { controller, commit, fail, apply } = makeHarness({
      uidRef,
      applyImpl: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    await controller.submit(makeDraft());
    expect(fail).toHaveBeenCalledTimes(1);

    // B abre a mesma tela: loadPending() reseta o estado em memória e nada aparece.
    uidRef.current = 'user-2';
    expect(controller.loadPending()).toBeNull();
    expect(controller.pendingAttempt()).toBeNull();

    // A volta e recupera a própria tentativa.
    uidRef.current = 'user-1';
    const pending = controller.loadPending();
    expect(pending).not.toBeNull();
    expect(pending!.uid).toBe('user-1');
    expect(controller.pendingAttempt()).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('#6 interface não interativa (hidratação pendente) ignora cliques', async () => {
    // isInteractive padrão retorna true no harness; recrio com gate fechado.
    const uidRef = { current: 'user-1' };
    const { store } = makeFakeStore();
    const gateway: ReceiptGateway = { apply: vi.fn(async (attempt) => makeResult(attempt)) };
    const manager = createReceiptSubmissionManager({
      currentUid: () => uidRef.current,
      generateReceiptOperationId: () => 'receipt-abc123',
      store,
      gateway,
    });
    const commit = vi.fn();
    const fail = vi.fn();
    const locked = createReceiptSubmissionController(manager, {
      commit,
      fail,
      isInteractive: () => false,
    });

    await locked.submit(makeDraft());
    expect(gateway.apply).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('idle');
  });
});