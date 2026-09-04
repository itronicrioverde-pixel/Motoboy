/**
 * Entidade de domínio IncomeEntry (pura, readonly e IMUTÁVEL).
 *
 * Sem cancelledAt/updatedAt: correção é sempre um novo lançamento (ver DEC-014).
 * Reutiliza `Cents` (shared/currency) e validação de data (shared/validation).
 * Falhas de negócio usam Result discriminado.
 */

import { type Cents, toCents } from '../../../shared/currency';
import { isValidEffectiveDate } from '../../../shared/validation';

export type IncomeDirection = 'credit' | 'debit';
export type IncomeSourceType = 'payment' | 'manual';

export interface IncomeRepository {
  list(): Promise<IncomeEntry[]>;
  observe(callback: (items: IncomeEntry[]) => void): () => void;
  save(entry: IncomeEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface IncomeEntry {
  readonly id: string;
  readonly direction: IncomeDirection;
  readonly amountCents: Cents;
  readonly sourceType: IncomeSourceType;
  readonly sourceId: string;
  readonly reversesIncomeEntryId?: string;
  readonly description: string;
  readonly effectiveDate: string;
}

export type IncomeErrorCode =
  | 'EMPTY_ID'
  | 'EMPTY_SOURCE_ID'
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_DIRECTION'
  | 'INVALID_SOURCE_TYPE'
  | 'PAYMENT_HAS_REVERSES_REF'
  | 'MANUAL_CREDIT_HAS_REVERSES_REF'
  | 'MANUAL_DEBIT_MISSING_REVERSES_REF';

export type IncomeValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: IncomeErrorCode; readonly message: string };

function isCents(n: number): n is Cents {
  try {
    toCents(n);
    return true;
  } catch {
    return false;
  }
}

function invalid(code: IncomeErrorCode, message: string): IncomeValidation {
  return { ok: false, code, message };
}

/** Valida todas as invariantes de um IncomeEntry. */
export function validateIncomeEntry(e: IncomeEntry): IncomeValidation {
  if (e.id.length === 0) return invalid('EMPTY_ID', 'id vazio.');
  if (e.sourceId.length === 0) return invalid('EMPTY_SOURCE_ID', 'sourceId vazio.');
  if (!isCents(e.amountCents) || (e.amountCents as number) <= 0) {
    return invalid('INVALID_AMOUNT', 'amountCents deve ser Cents > 0.');
  }
  if (!isValidEffectiveDate(e.effectiveDate)) return invalid('INVALID_DATE', 'effectiveDate inválida.');
  if (e.direction !== 'credit' && e.direction !== 'debit') {
    return invalid('INVALID_DIRECTION', 'direction inválida.');
  }

  if (e.sourceType === 'payment') {
    // credit e debit permitidos; reversão de Payment usa debit. Sem ref de reversão.
    if (e.reversesIncomeEntryId !== undefined) {
      return invalid('PAYMENT_HAS_REVERSES_REF', 'origem payment não usa reversesIncomeEntryId.');
    }
  } else if (e.sourceType === 'manual') {
    if (e.direction === 'credit') {
      if (e.reversesIncomeEntryId !== undefined) {
        return invalid('MANUAL_CREDIT_HAS_REVERSES_REF', 'manual credit não usa reversesIncomeEntryId.');
      }
    } else {
      // manual debit = estorno de entrada manual: exige a referência.
      if (e.reversesIncomeEntryId === undefined || e.reversesIncomeEntryId.length === 0) {
        return invalid('MANUAL_DEBIT_MISSING_REVERSES_REF', 'manual debit exige reversesIncomeEntryId.');
      }
    }
  } else {
    return invalid('INVALID_SOURCE_TYPE', 'sourceType inválido.');
  }

  return { ok: true };
}
