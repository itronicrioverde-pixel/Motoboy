/**
 * Composition root da feature Receivables.
 * Monta o serviço com o repositório Firestore, escopado pelo uid atual.
 */

import { currentUid } from '../auth/application/auth-service';
import { ReceivablesService } from './application/receivables-service';
import { FirestoreReceivableRepository } from './infrastructure/firestore-receivable-repository';

const repository = new FirestoreReceivableRepository(() => currentUid());

export const receivablesService = new ReceivablesService(repository);

export { ReceivableValidationError } from './application/receivables-service';
export type { Receivable, ReceivableStatus, ReceivableSourceType } from './domain/receivable';
