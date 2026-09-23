/**
 * Controlador de apresentação da submissão de recebimentos.
 *
 * Orquestra o clique do usuário sobre o gerenciador de recebimentos, sem tocar
 * DOM, janela global nem APIs de armazenamento; não depende de banco remoto:
 * o apresentador injeta as chamadas de efeito (commit/fail/isInteractive) e o
 * controlador garante:
 * - Lock de clique compartilhado entre submit e retry (uma operação por vez);
 * - No máximo uma confirmação por submissão (cliques repetidos não reaplicam);
 * - Falha mantém a interface no modo de retentativa (falha → callback fail);
 * - O fluxo de retry reutiliza a tentativa persistida, nunca gera novo ID.
 *
 * O contrato nunca rejeita: submit/retry resolvem sempre, commit no sucesso,
 * fail na falha. Enquanto uma operação está em andamento, novas chamadas
 * retornam a MESMA Promise (lock de clique).
 */

import type {
  ApplyReceiptResult,
  PendingReceiptAttempt,
  ReceiptDraft,
  ReceiptSubmissionManager,
} from '../application/receipt-submission-manager';

export interface ReceiptSubmissionCallbacks {
  /** Confirmação autoritativa: aplica o estado local (toast + close no painel). */
  commit(result: ApplyReceiptResult): void;
  /** Falha: mantém o modal aberto e ativa o modo de retentativa. */
  fail(error: unknown): void;
  /** Define se a interface está pronta (hidratação concluída). */
  isInteractive(): boolean;
}

export interface ReceiptSubmissionController {
  /** true enquanto há uma submissão/retry em andamento (lock de clique). */
  isRunning(): boolean;
  submit(draft: ReceiptDraft): Promise<void>;
  retry(): Promise<void>;
  loadPending(): PendingReceiptAttempt | null;
  /** Tentativa atual (pending/inFlight/failed) do estado do manager. */
  pendingAttempt(): PendingReceiptAttempt | null;
}

/**
 * Cria o controlador. Sempre que `isInteractive()` for false, submit/retry são
 * ignorados (o painel chama o mesmo gate na hidratação).
 */
export function createReceiptSubmissionController(
  manager: ReceiptSubmissionManager,
  callbacks: ReceiptSubmissionCallbacks,
): ReceiptSubmissionController {
  let inFlight: Promise<void> | null = null;

  function run(action: () => Promise<ApplyReceiptResult>): Promise<void> {
    if (inFlight) return inFlight;
    if (!callbacks.isInteractive()) return Promise.resolve();

    // Promise.resolve() para capturar também erros SÍNCRONOS do action
    // (ex.: recusa de nova submissão com tentativa pendente) e encaminhá-los a fail.
    const promise = Promise.resolve()
      .then(() => action())
      .then((result) => {
        callbacks.commit(result);
      })
      .catch((error) => {
        callbacks.fail(error);
      })
      .finally(() => {
        if (inFlight === promise) inFlight = null;
      });
    inFlight = promise;
    return promise;
  }

  return {
    isRunning: () => inFlight !== null,
    submit: (draft) => run(() => manager.submit(draft)),
    retry: () => run(() => manager.retry()),
    loadPending: () => manager.loadPending(),
    pendingAttempt: () => {
      const state = manager.getState();
      if (state.status === 'pending' || state.status === 'inFlight' || state.status === 'failed') {
        return state.attempt;
      }
      return null;
    },
  };
}