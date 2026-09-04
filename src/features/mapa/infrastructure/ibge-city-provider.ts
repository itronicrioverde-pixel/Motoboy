/**
 * Provedor de cidades brasileiras usando a API pública do IBGE.
 *
 * API gratuita, sem chave, sem limite de uso.
 * Endpoint: https://servicodados.ibge.gov.br/api/v1/localidades/municipios
 * Retorna todas as ~5.570 cidades do Brasil com código IBGE, UF e coordenadas.
 */

import type { BrazilianCity, CityProvider } from '../domain/cities';
import type { GeoPoint } from '../domain/routing';

const IBGE_API_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';

/** Resposta bruta da API do IBGE. */
interface IbgeMunicipio {
  id: number;
  nome: string;
  microrregiao?: {
    mesorregiao?: {
      UF?: {
        id: number;
        sigla: string;
        nome: string;
      };
    };
  };
  /** Coordenadas vindas da API de localidades. */
  centroide?: [number, lon: number]; // [lat, lon]
}

function toCity(m: IbgeMunicipio): BrazilianCity | null {
  const state = m.microrregiao?.mesorregiao?.UF;
  if (!state) return null;

  const coords: GeoPoint = m.centroide
    ? { lat: m.centroide[0], lon: m.centroide[1] }
    : { lat: -14.235, lon: -51.925 }; // centro do Brasil como fallback

  return {
    ibgeCode: String(m.id),
    name: m.nome,
    state: state.sigla,
    stateName: state.nome,
    coordinates: coords,
  };
}

export class IbgeCityProvider implements CityProvider {
  private cache: BrazilianCity[] | null = null;

  async listAll(): Promise<readonly BrazilianCity[]> {
    if (this.cache) return this.cache;

    try {
      const res = await fetch(IBGE_API_URL);
      if (!res.ok) return [];
      const data: unknown = await res.json();
      const municipios = data as IbgeMunicipio[];
      this.cache = municipios
        .map(toCity)
        .filter((c): c is BrazilianCity => c !== null)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      return this.cache;
    } catch {
      return [];
    }
  }

  async search(query: string, limit = 10): Promise<readonly BrazilianCity[]> {
    if (!query.trim()) return [];
    const all = await this.listAll();
    const termo = query.trim().toLowerCase();
    return all
      .filter((c) => {
        const nameMatch = c.name.toLowerCase().includes(termo);
        const stateMatch = c.state.toLowerCase() === termo;
        const ibgeMatch = c.ibgeCode.includes(termo);
        return nameMatch || stateMatch || ibgeMatch;
      })
      .slice(0, limit);
  }

  async listByState(state: string): Promise<readonly BrazilianCity[]> {
    const all = await this.listAll();
    const uf = state.toUpperCase();
    return all.filter((c) => c.state === uf);
  }
}
