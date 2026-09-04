/**
 * Domínio de geocodificação (busca de endereço, geocodificação reversa, detecção de região).
 *
 * Interfaces neutras: o app depende delas, não do Photon/Nominatim/Google.
 * Permite trocar o provedor sem mudar quem consome.
 */

import type { GeoPoint } from './routing';

/** Resultado de busca de endereço (autocomplete). */
export interface GeocodingResult {
  /** Label legível para o usuário. */
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
}

/** Informações da cidade/região atual do dispositivo. */
export interface RegionPlace {
  readonly city: string;
  readonly state: string | null;
}

/** Dados de geocodificação reversa (lat/lon → cidade/estado). */
export interface ReverseGeocodeResult {
  readonly city: string;
  readonly state: string | null;
}

/**
 * Provedor de geocodificação (busca de endereço).
 * Interface neutra: o app depende dela, não do Photon.
 */
export interface GeocodingProvider {
  /**
   * Busca endereços por texto (autocomplete).
   * @param query Texto de busca do usuário.
   * @param limit Número máximo de resultados.
   * @param center Centro regional opcional para priorizar resultados próximos.
   * @returns Lista de resultados ou array vazio.
   */
  search(query: string, limit: number, center?: GeoPoint): Promise<readonly GeocodingResult[]>;

  /** Geocodificação reversa: lat/lon → cidade/estado. */
  reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null>;
}
