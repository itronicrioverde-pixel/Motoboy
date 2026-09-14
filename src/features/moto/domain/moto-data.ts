/**
 * Entidade de domínio: dados da moto do motoboy.
 *
 * Informações Persistentes: km atual, consumo (km/L), se o consumo é manual.
 * O nome, ano e capacidade do tanque podem ser expandidos no futuro.
 */

export interface MotoData {
  /** Quilometragem atual (km do hodômetro). */
  readonly currentKm: number;
  /** Consumo atual em km/L. */
  readonly consumption: number;
  /** true quando o motoboy fixou o consumo manualmente. */
  readonly consumptionIsManual: boolean;
}

export interface UpdateMotoInput {
  readonly currentKm?: number;
  readonly consumption?: number;
  readonly consumptionIsManual?: boolean;
}

export interface MotoRepository {
  get(): Promise<MotoData>;
  save(data: MotoData): Promise<void>;
}
