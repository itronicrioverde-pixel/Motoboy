/**
 * Gerenciador de submissão de recebimentos com idempotência e retry.
 *
 * Responsabilidades:
 * - Lock de concorrência compartilhado entre submit() e retry() (uma única operação por vez).
 * - Persistência da tentativa ANTES de chamar o gateway (sem tentativa persistida não há retry seguro).
 * - Reutilização do mesmo receiptOperationId entre a submissão original e o retry.
 * - Isolamento por UID: cada usuário só enxerga e limpa a própria tentativa.
 * - Proibição de descarte silencioso: enquanto houver tentativa persistida, um novo submit é recusado.
 *
 * Este módulo é isolado da infraestrutura: não acessa banco de dados remoto, DOM do
 * navegador, objeto global de janela nem APIs de armazenamento. A notificação ao
 * usuário é responsabilidade do apresentador (painel).
 */

import type { LegacyCliente } from './merge-legacy-customers';

/** Rascunho de recebimento preenchido pela interface. */
export interface ReceiptDraft {
  /** Identificador estável do cliente, quando ele já possui ID no Firestore. */
  readonly clientId?: string;
  /** Nome exato usado apenas para localizar um cliente legado sem ID. */
  readonly legacyLookupName?: string;
  readonly valor: number;
  /** Data no formato AAAA-MM-DD. */
  readonly dateISO: string;
  /** Rótulo curto da data (ex: "Hoje", "Ontem" ou "12/06/2026"). */
  readonly dateLabel: string;
}

/** Tentativa de recebimento persistida e candidata a retry. */
export interface PendingReceiptAttempt extends ReceiptDraft {
  readonly uid: string;
  readonly receiptOperationId: string;
  readonly createdAt: number;
}

export type ReceiptSubmissionState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending'; readonly attempt: PendingReceiptAttempt }
  | { readonly status: 'inFlight'; readonly attempt: PendingReceiptAttempt }
  | { readonly status: 'failed'; readonly attempt: PendingReceiptAttempt; readonly error: unknown };

/** Persistência da tentativa, isolada por uid. */
export interface PendingReceiptStore {
  load(uid: string): PendingReceiptAttempt | null;
  save(attempt: PendingReceiptAttempt): void;
  clear(uid: string, receiptOperationId: string): void;
}

/** Entrada de faturamento construída pelo gateway de recebimento. */
export interface ReceiptBillingEntry {
  readonly receiptOperationId: string;
  readonly source: 'client_receipt';
  readonly clientId: string | null;
  readonly clientName: string;
  readonly desc: string;
  readonly valor: number;
  readonly data: string;
  readonly dateISO: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ApplyReceiptResult {
  readonly clientes: LegacyCliente[];
  readonly billingEntry: ReceiptBillingEntry;
  readonly receiptOperationId: string;
  readonly status: 'applied' | 'already-applied';
}

/** Gateway de aplicação transacional do recebimento (implementado na infraestrutura). */
export interface ReceiptGateway {
  apply(attempt: PendingReceiptAttempt): Promise<ApplyReceiptResult>;
}

export interface ReceiptSubmissionManagerDependencies {
  /** Retorna o UID atual; null significa sessão não autenticada. */
  readonly currentUid: () => string | null;
  readonly generateReceiptOperationId: () => string;
  readonly store: PendingReceiptStore;
  readonly gateway: ReceiptGateway;
}

export interface ReceiptSubmissionManager {
  getState(): ReceiptSubmissionState;
  /** Carrega a tentativa persistida do usuário atual (null quando não há). */
  loadPending(): PendingReceiptAttempt | null;
  submit(draft: ReceiptDraft): Promise<ApplyReceiptResult>;
  retry(): Promise<ApplyReceiptResult>;
}

const PENDING_ATTEMPT_ERROR =
  'Existe um recebimento pendente da última tentativa que ainda não foi confirmado. ' +
  'Use "Retentar recebimento" para retomar a tentativa anterior.';
const NO_ATTEMPT_ERROR =
  'Não existe recebimento pendente para retomar. Preencha um novo recebimento.';
const SESSION_CHANGED_ERROR =
  'Sessão alterada durante o recebimento. A tentativa não confirmada permanece guardada na ' +
  'conta anterior e não pode ser aplicada nesta sessão.';
const AUTH_REQUIRED_ERROR = 'Sem usuário autenticado para registrar recebimento.';

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateDraft(draft: ReceiptDraft): Required<Pick<ReceiptDraft, 'valor' | 'dateISO' | 'dateLabel'>> & {
  readonly clientId?: string;
  readonly legacyLookupName?: string;
} {
  if (!draft || typeof draft !== 'object') {
    throw new Error('Recebimento inválido para submissão.');
  }
  const valor = Number(draft.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('valor do recebimento deve ser maior que zero.');
  }
  if (typeof draft.dateISO !== 'string' || !DATE_ISO_REGEX.test(draft.dateISO)) {
    throw new Error('dateISO inválida para recebimento.');
  }
  if (typeof draft.dateLabel !== 'string' || !draft.dateLabel.trim()) {
    throw new Error('dateLabel inválida para recebimento.');
  }
  const clientId =
    typeof draft.clientId === 'string' && draft.clientId.trim() ? draft.clientId.trim() : undefined;
  const legacyLookupName =
    typeof draft.legacyLookupName === 'string' && draft.legacyLookupName.trim()
      ? draft.legacyLookupName.trim()
      : undefined;
  if (!clientId && !legacyLookupName) {
    throw new Error('clientId ou legacyLookupName é obrigatório para recebimento.');
  }
  return { valor, dateISO: draft.dateISO, dateLabel: draft.dateLabel.trim(), clientId, legacyLookupName };
}

export function createReceiptSubmissionManager(
  dependencies: ReceiptSubmissionManagerDependencies,
): ReceiptSubmissionManager {
  let state: ReceiptSubmissionState = { status: 'idle' };
  let inFlight: Promise<ApplyReceiptResult> | null = null;

  function currentUidOrThrow(): string {
    const uid = dependencies.currentUid();
    if (!uid) {
      throw new Error(AUTH_REQUIRED_ERROR);
    }
    return uid;
  }

  /**
   * Troca de sessão: descarta o estado em memória quando o UID atual não é o dono
   * da tentativa carregada. Nada é apagado do store — a tentativa permanece
   * persistida na chave da conta que a criou e é recuperada quando o dono volta.
   * Chamado em toda leitura de estado e em toda ação para que a conta atual nunca
   * veja dados carregados por outra conta.
   */
  function resetStaleMemoryState(): void {
    const current = state;
    if (current.status === 'idle') return;
    const uid = dependencies.currentUid();
    if (!uid || uid !== current.attempt.uid) {
      state = { status: 'idle' };
    }
  }

  /** Leitura tolerante: JSON corrompido ou storage indisponível não pode quebrar o painel. */
  function safeLoad(uid: string): PendingReceiptAttempt | null {
    try {
      return dependencies.store.load(uid);
    } catch {
      return null;
    }
  }

  function startAttempt(attempt: PendingReceiptAttempt): Promise<ApplyReceiptResult> {
    if (inFlight) return inFlight;
    const promise = executeAttempt(attempt);
    inFlight = promise;
    return promise;
  }

  async function executeAttempt(attempt: PendingReceiptAttempt): Promise<ApplyReceiptResult> {
    state = { status: 'inFlight', attempt };
    try {
      const result = await dependencies.gateway.apply(attempt);

      const currentUidAtCompletion = dependencies.currentUid();
      if (currentUidAtCompletion !== attempt.uid) {
        // A tentativa pertence à conta que a criou; não confirmar nesta sessão nem limpar.
        // O estado em memória também não pode expor a tentativa da conta anterior.
        const error = new Error(SESSION_CHANGED_ERROR);
        state = { status: 'idle' };
        throw error;
      }

      // Confirmação só limpa a tentativa que o gateway confirmou (uid + receiptOperationId).
      dependencies.store.clear(attempt.uid, attempt.receiptOperationId);
      state = { status: 'idle' };
      return result;
    } catch (error) {
      // Falha preserva a tentativa e o receiptOperationId para permitir retry — mas
      // somente se a sessão ainda pertence ao dono da tentativa. Se o usuário mudou,
      // nada da conta anterior fica visível no estado em memória.
      if (dependencies.currentUid() === attempt.uid) {
        state = { status: 'failed', attempt, error };
      } else {
        state = { status: 'idle' };
      }
      throw error;
    } finally {
      inFlight = null;
    }
  }

  function loadPending(): PendingReceiptAttempt | null {
    resetStaleMemoryState();
    const uid = dependencies.currentUid();
    if (!uid) {
      state = { status: 'idle' };
      return null;
    }
    const existing = safeLoad(uid);
    if (existing) {
      state = { status: 'pending', attempt: existing };
      return existing;
    }
    state = { status: 'idle' };
    return null;
  }

  function submit(draft: ReceiptDraft): Promise<ApplyReceiptResult> {
    if (inFlight) return inFlight;
    resetStaleMemoryState();
    const uid = currentUidOrThrow();

    // Enquanto existir tentativa persistida, nenhuma nova submissão (mesmo payload idêntico)
    // pode descartá-la silenciosamente: o fluxo é retomar via retry.
    const existing = safeLoad(uid);
    if (existing) {
      throw new Error(PENDING_ATTEMPT_ERROR);
    }

    const validated = validateDraft(draft);
    const attempt: PendingReceiptAttempt = {
      uid,
      receiptOperationId: String(dependencies.generateReceiptOperationId()),
      createdAt: Date.now(),
      valor: validated.valor,
      dateISO: validated.dateISO,
      dateLabel: validated.dateLabel,
      clientId: validated.clientId,
      legacyLookupName: validated.legacyLookupName,
    };

    // Persistência ANTES do gateway: falha ao persistir impede a chamada ao gateway.
    dependencies.store.save(attempt);

    state = { status: 'pending', attempt };
    return startAttempt(attempt);
  }

  function retry(): Promise<ApplyReceiptResult> {
    if (inFlight) return inFlight;
    resetStaleMemoryState();
    const uid = currentUidOrThrow();

    const existing = safeLoad(uid);
    if (!existing) {
      state = { status: 'idle' };
      throw new Error(NO_ATTEMPT_ERROR);
    }

    state = { status: 'pending', attempt: existing };
    return startAttempt(existing);
  }

  return {
    getState: () => {
      resetStaleMemoryState();
      return state;
    },
    loadPending,
    submit,
    retry,
  };
}