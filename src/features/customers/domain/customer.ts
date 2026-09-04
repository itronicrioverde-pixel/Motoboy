/**
 * Entidade de domínio Customer (pura, readonly).
 *
 * Sem createdAt/updatedAt (metadados de infraestrutura ficam no DTO futuro).
 * Sem Firebase, DOM, relógio ou I/O. Falhas de negócio usam Result discriminado.
 */

export type CustomerStatus = 'active' | 'archived';

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
  readonly nickname?: string;
  readonly notes?: string;
  readonly status: CustomerStatus;
}

export interface CreateCustomerInput {
  readonly name: string;
  readonly phone?: string;
  readonly nickname?: string;
  readonly notes?: string;
}

export interface UpdateCustomerInput {
  readonly name?: string;
  readonly phone?: string;
  readonly nickname?: string;
  readonly notes?: string;
}

export interface CustomerRepository {
  list(): Promise<Customer[]>;
  observe(callback: (items: Customer[]) => void): () => void;
  create(input: CreateCustomerInput): Promise<Customer>;
  update(id: string, input: UpdateCustomerInput): Promise<void>;
  archive(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export type CustomerErrorCode = 'EMPTY_ID' | 'EMPTY_NAME' | 'INVALID_STATUS';

export type CustomerValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CustomerErrorCode; readonly message: string };

function invalid(code: CustomerErrorCode, message: string): CustomerValidation {
  return { ok: false, code, message };
}

/**
 * Valida uma entidade Customer. Nomes duplicados NÃO são checados aqui (o
 * domínio permite nomes iguais; unicidade é responsabilidade de outra camada).
 */
export function validateCustomer(customer: Customer): CustomerValidation {
  if (customer.id.length === 0) return invalid('EMPTY_ID', 'id do cliente vazio.');
  if (customer.name.trim().length === 0) return invalid('EMPTY_NAME', 'nome do cliente vazio.');
  if (customer.status !== 'active' && customer.status !== 'archived') {
    return invalid('INVALID_STATUS', 'status de cliente inválido.');
  }
  return { ok: true };
}

/**
 * Arquiva um cliente retornando uma NOVA entidade com status 'archived'.
 * Não muta a original. Idempotente: arquivar um já arquivado devolve outra
 * entidade equivalente com status 'archived'.
 */
export function archiveCustomer(customer: Customer): Customer {
  return { ...customer, status: 'archived' };
}
