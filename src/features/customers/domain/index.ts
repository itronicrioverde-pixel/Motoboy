/**
 * API pública do domínio Customer. Sem default export; sem helpers internos.
 */

export type {
  Customer,
  CustomerStatus,
  CustomerErrorCode,
  CustomerValidation,
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerRepository,
} from './customer';
export { validateCustomer, archiveCustomer } from './customer';
