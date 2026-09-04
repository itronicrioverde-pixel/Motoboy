/**
 * Casos de uso de Customers (camada de aplicação).
 *
 * Orquestra o domínio e depende apenas da interface CustomerRepository (injetada).
 * Não conhece Firestore nem DOM.
 */

import type { Customer, CustomerRepository } from '../domain/customer';

export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export class CustomersService {
  constructor(private readonly repo: CustomerRepository) {}

  list(): Promise<Customer[]> {
    return this.repo.list();
  }

  observe(callback: (items: Customer[]) => void): () => void {
    return this.repo.observe(callback);
  }

  async create(data: { name: string; phone?: string; nickname?: string; notes?: string }): Promise<Customer> {
    if (!data.name.trim()) {
      throw new CustomerValidationError('Nome do cliente é obrigatório.');
    }
    return this.repo.create({
      name: data.name.trim(),
      phone: data.phone?.trim() || undefined,
      nickname: data.nickname?.trim() || undefined,
      notes: data.notes?.trim() || undefined,
    });
  }

  async update(id: string, data: { name?: string; phone?: string; nickname?: string; notes?: string }): Promise<void> {
    if (data.name !== undefined && !data.name.trim()) {
      throw new CustomerValidationError('Nome do cliente não pode ser vazio.');
    }
    return this.repo.update(id, {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.phone !== undefined && { phone: data.phone.trim() || undefined }),
      ...(data.nickname !== undefined && { nickname: data.nickname.trim() || undefined }),
      ...(data.notes !== undefined && { notes: data.notes.trim() || undefined }),
    });
  }

  async archive(id: string): Promise<void> {
    return this.repo.archive(id);
  }

  async remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
