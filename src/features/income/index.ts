/**
 * Composition root da feature Income.
 * Monta o serviço com o repositório Firestore, escopado pelo uid atual.
 */

import { currentUid } from '../auth/application/auth-service';
import { IncomeService } from './application/income-service';
import { FirestoreIncomeRepository } from './infrastructure/firestore-income-repository';

const repository = new FirestoreIncomeRepository(() => currentUid());

export const incomeService = new IncomeService(repository);

export { IncomeValidationError } from './application/income-service';
export type { IncomeEntry, IncomeDirection, IncomeSourceType } from './domain/income-entry';
