/**
 * Adaptador que liga o ReceiptGateway (camada de aplicação) ao writer financeiro
 * transacional durante a submissão.
 */

import type { PendingReceiptAttempt } from '../application/receipt-submission-manager';
import type { ReceiptGateway } from '../application/receipt-submission-manager';
import { applyReceiptDual } from './client-writer';

export function createClientReceiptGateway(): ReceiptGateway {
  return {
    async apply(attempt: PendingReceiptAttempt) {
      return applyReceiptDual({
        clientId: attempt.clientId,
        legacyLookupName: attempt.clientId ? undefined : attempt.legacyLookupName,
        valor: attempt.valor,
        dateISO: attempt.dateISO,
        dateLabel: attempt.dateLabel,
        receiptOperationId: attempt.receiptOperationId,
      });
    },
  };
}