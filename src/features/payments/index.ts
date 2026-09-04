/**
 * Composition root da feature Payments.
 * Monta o serviço com o repositório Firestore, escopado pelo uid atual.
 */

import { currentUid } from '../auth/application/auth-service';
import { PaymentsService } from './application/payments-service';
import { FirestorePaymentRepository } from './infrastructure/firestore-payment-repository';

const repository = new FirestorePaymentRepository(() => currentUid());

export const paymentsService = new PaymentsService(repository);

export { PaymentValidationError } from './application/payments-service';
export type { Payment, PaymentKind, Allocation } from './domain/payment';
