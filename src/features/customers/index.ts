/**
 * Composition root da feature Customers.
 * Monta o serviço com o repositório Firestore, escopado pelo uid atual.
 */

import { currentUid } from '../auth/application/auth-service';
import { CustomersService } from './application/customers-service';
import { FirestoreCustomerRepository } from './infrastructure/firestore-customer-repository';

const repository = new FirestoreCustomerRepository(() => currentUid());

export const customersService = new CustomersService(repository);

export { CustomerValidationError } from './application/customers-service';
export type { Customer, CustomerStatus } from './domain/customer';
