/**
 * Entidades de domínio Payment e Allocation (puras, readonly).
 *
 * Reutiliza `Cents` + aritmética segura (shared/currency), validação de data e
 * de idempotencyKey (shared/validation). Imutável: nenhum helper altera o
 * Payment recebido. Falhas de negócio usam Result discriminado.
 */

import { type Cents, toCents, addCents } from '../../../shared/currency';
import { isValidEffectiveDate, isValidIdempotencyKey } from '../../../shared/validation';

export interface Allocation {
  readonly receivableId: string;
  readonly amountCents: Cents;
}

export type PaymentKind = 'payment' | 'reversal';

export interface CreatePaymentInput {
  readonly clientId: string;
  readonly amountCents: Cents;
  readonly allocations: readonly Allocation[];
  readonly effectiveDate: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly kind: PaymentKind;
  readonly reversesPaymentId?: string;
}

export interface PaymentRepository {
  list(): Promise<Payment[]>;
  listByClient(clientId: string): Promise<Payment[]>;
  observe(callback: (items: Payment[]) => void): () => void;
  save(payment: Payment): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Payment {
  readonly id: string;
  readonly clientId: string;
  readonly amountCents: Cents;
  readonly allocations: readonly Allocation[];
  readonly effectiveDate: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly kind: PaymentKind;
  readonly reversesPaymentId?: string;
}

export type PaymentErrorCode =
  | 'EMPTY_ID'
  | 'EMPTY_CLIENT_ID'
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'EMPTY_REQUEST_HASH'
  | 'EMPTY_ALLOCATIONS'
  | 'INVALID_ALLOCATION'
  | 'DUPLICATE_RECEIVABLE'
  | 'ALLOCATIONS_SUM_MISMATCH'
  | 'SUM_OVERFLOW'
  | 'INVALID_KIND'
  | 'PAYMENT_HAS_REVERSES'
  | 'REVERSAL_MISSING_REVERSES';

export type PaymentValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: PaymentErrorCode; readonly message: string };

function isCents(n: number): n is Cents {
  try {
    toCents(n);
    return true;
  } catch {
    return false;
  }
}

function invalid(code: PaymentErrorCode, message: string): PaymentValidation {
  return { ok: false, code, message };
}

/** Valida todas as invariantes de um Payment (payment ou reversal). */
export function validatePayment(p: Payment): PaymentValidation {
  if (p.id.length === 0) return invalid('EMPTY_ID', 'id vazio.');
  if (p.clientId.length === 0) return invalid('EMPTY_CLIENT_ID', 'clientId vazio.');
  if (!isCents(p.amountCents) || (p.amountCents as number) <= 0) {
    return invalid('INVALID_AMOUNT', 'amountCents deve ser Cents > 0.');
  }
  if (!isValidEffectiveDate(p.effectiveDate)) return invalid('INVALID_DATE', 'effectiveDate inválida.');
  if (!isValidIdempotencyKey(p.idempotencyKey)) {
    return invalid('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey inválida.');
  }
  if (p.requestHash.length === 0) return invalid('EMPTY_REQUEST_HASH', 'requestHash vazio.');

  if (p.allocations.length === 0) return invalid('EMPTY_ALLOCATIONS', 'allocations vazias.');

  const seen = new Set<string>();
  for (const a of p.allocations) {
    if (a.receivableId.length === 0 || !isCents(a.amountCents) || (a.amountCents as number) <= 0) {
      return invalid('INVALID_ALLOCATION', 'allocation inválida (receivableId/amountCents).');
    }
    if (seen.has(a.receivableId)) return invalid('DUPLICATE_RECEIVABLE', 'receivableId duplicado nas allocations.');
    seen.add(a.receivableId);
  }

  let sum: Cents;
  try {
    let acc = toCents(0);
    for (const a of p.allocations) acc = addCents(acc, a.amountCents);
    sum = acc;
  } catch {
    return invalid('SUM_OVERFLOW', 'overflow ao somar allocations.');
  }
  if ((sum as number) !== (p.amountCents as number)) {
    return invalid('ALLOCATIONS_SUM_MISMATCH', 'soma das allocations difere de amountCents.');
  }

  if (p.kind === 'payment') {
    if (p.reversesPaymentId !== undefined) {
      return invalid('PAYMENT_HAS_REVERSES', 'payment não pode ter reversesPaymentId.');
    }
  } else if (p.kind === 'reversal') {
    if (p.reversesPaymentId === undefined || p.reversesPaymentId.length === 0) {
      return invalid('REVERSAL_MISSING_REVERSES', 'reversal exige reversesPaymentId.');
    }
  } else {
    return invalid('INVALID_KIND', 'kind inválido.');
  }

  return { ok: true };
}
