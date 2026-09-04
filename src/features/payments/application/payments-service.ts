/**
 * Casos de uso de Payments (camada de aplicação).
 *
 * Orquestra o domínio Payment + Allocation FIFO.
 * Depende apenas das interfaces PaymentRepository e ReceivableRepository.
 */

import { validatePayment, type Payment, type PaymentRepository } from '../domain/payment';

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

export class PaymentsService {
  constructor(private readonly repo: PaymentRepository) {}

  list(): Promise<Payment[]> {
    return this.repo.list();
  }

  listByClient(clientId: string): Promise<Payment[]> {
    return this.repo.listByClient(clientId);
  }

  observe(callback: (items: Payment[]) => void): () => void {
    return this.repo.observe(callback);
  }

  async save(payment: Payment): Promise<void> {
    const validation = validatePayment(payment);
    if (!validation.ok) {
      throw new PaymentValidationError(`Pagamento inválido: ${validation.message}`);
    }
    return this.repo.save(payment);
  }

  async remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
