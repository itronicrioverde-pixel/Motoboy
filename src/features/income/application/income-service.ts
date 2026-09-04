/**
 * Casos de uso de Income (camada de aplicação).
 *
 * Orquestra o domínio IncomeEntry.
 * Depende apenas da interface IncomeRepository (injetada).
 */

import { validateIncomeEntry, type IncomeEntry, type IncomeRepository } from '../domain/income-entry';

export class IncomeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncomeValidationError';
  }
}

export class IncomeService {
  constructor(private readonly repo: IncomeRepository) {}

  list(): Promise<IncomeEntry[]> {
    return this.repo.list();
  }

  observe(callback: (items: IncomeEntry[]) => void): () => void {
    return this.repo.observe(callback);
  }

  async save(entry: IncomeEntry): Promise<void> {
    const validation = validateIncomeEntry(entry);
    if (!validation.ok) {
      throw new IncomeValidationError(`Entrada de renda inválida: ${validation.message}`);
    }
    return this.repo.save(entry);
  }

  async remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
