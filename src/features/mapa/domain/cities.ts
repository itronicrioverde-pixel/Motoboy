/**
 * Domínio de Cidades Brasileiras.
 *
 * Interface neutra para dados do IBGE (Instituto Brasileiro de Geografia e Estatística).
 * O IBGE fornece dados gratuitos de todas as cidades do Brasil — sem chave, sem custo.
 */

import type { GeoPoint } from './routing';

/** Uma cidade brasileira com dados do IBGE. */
export interface BrazilianCity {
  /** Código IBGE (ex: 3550308 = São Paulo). */
  readonly ibgeCode: string;
  /** Nome da cidade. */
  readonly name: string;
  /** UF (ex: SP, RJ, MG). */
  readonly state: string;
  /** Nome completo do estado. */
  readonly stateName: string;
  /** Posição geográfica (centro da cidade). */
  readonly coordinates: GeoPoint;
}

/** Provedor de cidades brasileiras. */
export interface CityProvider {
  /** Lista todas as cidades do Brasil. */
  listAll(): Promise<readonly BrazilianCity[]>;
  /** Busca cidades por nome (parcial, case-insensitive). */
  search(query: string, limit?: number): Promise<readonly BrazilianCity[]>;
  /** Retorna cidades de um estado específico. */
  listByState(state: string): Promise<readonly BrazilianCity[]>;
}
