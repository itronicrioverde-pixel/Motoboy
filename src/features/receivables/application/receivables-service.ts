/**
 * Casos de uso de Receivables (camada de aplicação).
 *
 * Orquestra o domínio Receivable (validação, alocação, estorno, cancelamento).
 * Depende apenas da interface ReceivableRepository (injetada).
 */

import {
  validateReceivable,
  applyAllocation,
  reverseAllocation,
  cancelReceivable,
  type Receivable,
  type ReceivableRepository,
} from '../domain/receivable';
import type { Cents } from '../../../shared/currency';

export class ReceivableValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableValidationError';
  }
}

export class ReceivablesService {
  constructor(private readonly repo: ReceivableRepository) {}

  list(): Promise<Receivable[]> {
    return this.repo.list();
  }

  listByClient(clientId: string): Promise<Receivable[]> {
    return this.repo.listByClient(clientId);
  }

  listOpenByClient(clientId: string): Promise<Receivable[]> {
    return this.repo.listOpenByClient(clientId);
  }

  observe(callback: (items: Receivable[]) => void): () => void {
    return this.repo.observe(callback);
  }

  async save(receivable: Receivable): Promise<void> {
    const validation = validateReceivable(receivable);
    if (!validation.ok) {
      throw new ReceivableValidationError(`Receivable inválido: ${validation.message}`);
    }
    return this.repo.save(receivable);
  }

  async saveBatch(receivables: readonly Receivable[]): Promise<void> {
    for (const r of receivables) {
      const validation = validateReceivable(r);
      if (!validation.ok) {
        throw new ReceivableValidationError(`Receivable inválido: ${validation.message}`);
      }
    }
    return this.repo.saveBatch(receivables);
  }

  applyAllocationToReceivable(receivable: Receivable, amount: Cents): Receivable {
    const result = applyAllocation(receivable, amount);
    if (!result.ok) {
      throw new ReceivableValidationError(`Falha ao alocar: ${result.message}`);
    }
    return result.value;
  }

  reverseAllocationFromReceivable(receivable: Receivable, amount: Cents): Receivable {
    const result = reverseAllocation(receivable, amount);
    if (!result.ok) {
      throw new ReceivableValidationError(`Falha ao estornar: ${result.message}`);
    }
    return result.value;
  }

  cancelReceivableEntry(receivable: Receivable): Receivable {
    const result = cancelReceivable(receivable);
    if (!result.ok) {
      throw new ReceivableValidationError(`Falha ao cancelar: ${result.message}`);
    }
    return result.value;
  }

  async remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
