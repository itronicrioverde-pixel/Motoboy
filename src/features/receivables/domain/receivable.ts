/**
 * Entidade de domínio Receivable (pura, readonly) e suas transições.
 *
 * Reutiliza as primitivas compartilhadas: `Cents` e a aritmética segura de
 * moeda (shared/currency) e a validação de data (shared/validation). Não
 * consulta relógio nem I/O. `remainingCents` é sempre calculado, nunca
 * armazenado. Falhas de negócio usam Result discriminado.
 */

import { type Cents, toCents, addCents, subtractCents } from '../../../shared/currency';
import { isValidEffectiveDate, isValidServiceId } from '../../../shared/validation';

export type ReceivableSourceType = 'route' | 'manual';
export type ReceivableStatus = 'open' | 'partial' | 'paid' | 'cancelled';

export interface ReceivableRepository {
  list(): Promise<Receivable[]>;
  listByClient(clientId: string): Promise<Receivable[]>;
  listOpenByClient(clientId: string): Promise<Receivable[]>;
  observe(callback: (items: Receivable[]) => void): () => void;
  save(receivable: Receivable): Promise<void>;
  saveBatch(receivables: readonly Receivable[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Receivable {
  readonly id: string;
  readonly clientId: string;
  readonly sourceType: ReceivableSourceType;
  readonly sourceId: string;
  readonly serviceId?: string;
  readonly description: string;
  readonly amountCents: Cents;
  readonly paidCents: Cents;
  readonly status: ReceivableStatus;
  readonly effectiveDate: string;
  /** Chave de ordenação vinda da infraestrutura; o domínio não lê o relógio. */
  readonly createdAtEpochMs: number;
}

export type ReceivableErrorCode =
  | 'EMPTY_ID'
  | 'EMPTY_CLIENT_ID'
  | 'EMPTY_SOURCE_ID'
  | 'INVALID_AMOUNT'
  | 'INVALID_PAID'
  | 'PAID_OVER_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_STATUS'
  | 'STATUS_PAID_MISMATCH'
  | 'ROUTE_REQUIRES_SERVICE_ID'
  | 'MANUAL_HAS_SERVICE_ID'
  | 'INVALID_SERVICE_ID';

export type ReceivableValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ReceivableErrorCode; readonly message: string };

export type ReceivableOpErrorCode =
  | 'INVALID_RECEIVABLE'
  | 'INELIGIBLE_STATUS'
  | 'INVALID_AMOUNT'
  | 'OVER_ALLOCATION'
  | 'OVER_REVERSAL'
  | 'CANCELLED'
  | 'HAS_PAYMENTS';

export type ReceivableOpResult =
  | { readonly ok: true; readonly value: Receivable }
  | { readonly ok: false; readonly code: ReceivableOpErrorCode; readonly message: string };

// Reusa o contrato de Cents (fonte única em shared/currency) sem lançar exceção.
function isCents(n: number): n is Cents {
  try {
    toCents(n);
    return true;
  } catch {
    return false;
  }
}

function invalid(code: ReceivableErrorCode, message: string): ReceivableValidation {
  return { ok: false, code, message };
}

function opErr(code: ReceivableOpErrorCode, message: string): ReceivableOpResult {
  return { ok: false, code, message };
}

/** Status derivado de (amount, paid) para receivable NÃO cancelado. */
function statusFor(amountCents: Cents, paidCents: Cents): ReceivableStatus {
  if (paidCents === 0) return 'open';
  if (paidCents === (amountCents as number)) return 'paid';
  return 'partial';
}

/** Valida todas as invariantes estruturais e de status de um Receivable. */
export function validateReceivable(r: Receivable): ReceivableValidation {
  if (r.id.length === 0) return invalid('EMPTY_ID', 'id vazio.');
  if (r.clientId.length === 0) return invalid('EMPTY_CLIENT_ID', 'clientId vazio.');
  if (r.sourceId.length === 0) return invalid('EMPTY_SOURCE_ID', 'sourceId vazio.');

  if (!isCents(r.amountCents) || (r.amountCents as number) <= 0) {
    return invalid('INVALID_AMOUNT', 'amountCents deve ser Cents > 0.');
  }
  if (!isCents(r.paidCents)) return invalid('INVALID_PAID', 'paidCents deve ser Cents >= 0.');
  if ((r.paidCents as number) > (r.amountCents as number)) {
    return invalid('PAID_OVER_AMOUNT', 'paidCents não pode exceder amountCents.');
  }

  if (!isValidEffectiveDate(r.effectiveDate)) {
    return invalid('INVALID_DATE', 'effectiveDate inválida.');
  }
  if (!Number.isSafeInteger(r.createdAtEpochMs) || r.createdAtEpochMs < 0) {
    return invalid('INVALID_TIMESTAMP', 'createdAtEpochMs deve ser inteiro seguro >= 0.');
  }

  if (r.status !== 'open' && r.status !== 'partial' && r.status !== 'paid' && r.status !== 'cancelled') {
    return invalid('INVALID_STATUS', 'status inválido.');
  }
  if (r.status === 'cancelled') {
    if ((r.paidCents as number) !== 0) {
      return invalid('STATUS_PAID_MISMATCH', 'cancelled exige paidCents == 0.');
    }
  } else if (r.status !== statusFor(r.amountCents, r.paidCents)) {
    return invalid('STATUS_PAID_MISMATCH', 'status não corresponde a paidCents.');
  }

  if (r.sourceType === 'route') {
    if (r.serviceId === undefined) return invalid('ROUTE_REQUIRES_SERVICE_ID', 'rota exige serviceId.');
    if (!isValidServiceId(r.serviceId)) return invalid('INVALID_SERVICE_ID', 'serviceId inválido.');
  } else if (r.sourceType === 'manual') {
    if (r.serviceId !== undefined) return invalid('MANUAL_HAS_SERVICE_ID', 'manual não pode ter serviceId.');
  } else {
    return invalid('INVALID_STATUS', 'sourceType inválido.');
  }

  return { ok: true };
}

/** Saldo restante calculado (amountCents - paidCents). */
export function remainingCents(r: Receivable): Cents {
  return subtractCents(r.amountCents, r.paidCents);
}

/**
 * Aplica uma alocação de pagamento. Só em open/partial, valor > 0 e sem
 * ultrapassar o saldo. Recomputa o status. Retorna NOVA entidade.
 */
export function applyAllocation(r: Receivable, amount: Cents): ReceivableOpResult {
  if (!validateReceivable(r).ok) return opErr('INVALID_RECEIVABLE', 'receivable inválido.');
  if (r.status !== 'open' && r.status !== 'partial') {
    return opErr('INELIGIBLE_STATUS', 'só é possível alocar em open ou partial.');
  }
  if (!isCents(amount) || (amount as number) <= 0) {
    return opErr('INVALID_AMOUNT', 'valor de alocação deve ser Cents > 0.');
  }
  if ((amount as number) > (remainingCents(r) as number)) {
    return opErr('OVER_ALLOCATION', 'alocação excede o saldo restante.');
  }
  const paidCents = addCents(r.paidCents, amount);
  return { ok: true, value: { ...r, paidCents, status: statusFor(r.amountCents, paidCents) } };
}

/**
 * Estorna parte/todo de um pagamento. Não permite cancelled, valor > 0 e sem
 * ultrapassar paidCents. Recomputa open/partial/paid. Retorna NOVA entidade.
 */
export function reverseAllocation(r: Receivable, amount: Cents): ReceivableOpResult {
  if (!validateReceivable(r).ok) return opErr('INVALID_RECEIVABLE', 'receivable inválido.');
  if (r.status === 'cancelled') return opErr('CANCELLED', 'não é possível estornar um receivable cancelado.');
  if (!isCents(amount) || (amount as number) <= 0) {
    return opErr('INVALID_AMOUNT', 'valor de estorno deve ser Cents > 0.');
  }
  if ((amount as number) > (r.paidCents as number)) {
    return opErr('OVER_REVERSAL', 'estorno excede o valor pago.');
  }
  const paidCents = subtractCents(r.paidCents, amount);
  return { ok: true, value: { ...r, paidCents, status: statusFor(r.amountCents, paidCents) } };
}

/**
 * Cancela um receivable. Só quando paidCents == 0. Cancelar um já cancelado é
 * idempotente (retorna sucesso com a entidade cancelada). Não cria IncomeEntry.
 */
export function cancelReceivable(r: Receivable): ReceivableOpResult {
  if (!validateReceivable(r).ok) return opErr('INVALID_RECEIVABLE', 'receivable inválido.');
  if (r.status === 'cancelled') return { ok: true, value: r }; // idempotente
  if ((r.paidCents as number) !== 0) {
    return opErr('HAS_PAYMENTS', 'não é possível cancelar receivable com pagamentos; estorne antes.');
  }
  return { ok: true, value: { ...r, status: 'cancelled' } };
}
