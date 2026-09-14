/**
 * Serviço de dados da moto (camada de aplicação).
 *
 * Coordena leitura e escrita dos dados da moto no repositório.
 */

import type { MotoData, MotoRepository } from '../domain/moto-data';

export class MotoService {
  constructor(private readonly repo: MotoRepository) {}

  get(): Promise<MotoData> {
    return this.repo.get();
  }

  async save(data: MotoData): Promise<void> {
    if (data.currentKm < 0) throw new Error('Quilometragem não pode ser negativa.');
    if (data.consumption < 0) throw new Error('Consumo não pode ser negativo.');
    await this.repo.save(data);
  }
}
