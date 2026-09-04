/**
 * API pública do domínio Payment (entidades + FIFO). Sem default export.
 */

export type {
  Allocation,
  Payment,
  PaymentKind,
  PaymentErrorCode,
  PaymentValidation,
  CreatePaymentInput,
  PaymentRepository,
} from './payment';
export { validatePayment } from './payment';

export type {
  AllocationErrorCode,
  AllocateSuccess,
  AllocateFailure,
  AllocationResult,
} from './allocate-fifo';
export { MAX_FIFO, allocateFIFO } from './allocate-fifo';
