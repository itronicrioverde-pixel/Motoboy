/**
 * API pública do domínio Receivable. Sem default export; sem helpers internos.
 */

export type {
  Receivable,
  ReceivableSourceType,
  ReceivableStatus,
  ReceivableErrorCode,
  ReceivableValidation,
  ReceivableOpErrorCode,
  ReceivableOpResult,
  ReceivableRepository,
} from './receivable';
export {
  validateReceivable,
  remainingCents,
  applyAllocation,
  reverseAllocation,
  cancelReceivable,
} from './receivable';
