/**
 * Provedor de roteamento usando GraphHopper Route API.
 *
 * GraphHopper tem um tier gratuito com 500 requisições/dia.
 * Usa dados OpenStreetMap como OSRM, mas com melhor cobertura em
 * algumas áreas do Brasil e suporte a road attributes.
 *
 * Sem chave de API para o tier público (rate-limited).
 * Otimizado para motos (velocidade urbana brasileira).
 */

import type { GeoPoint, RouteResult, RoutingProvider } from '../domain/routing';

const ENDPOINT = 'https://graphhopper.com/api/1/route';

export class GraphHopperRoutingProvider implements RoutingProvider {
  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly timeoutMs = 10000,
  ) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    try {
      const params = new URLSearchParams({
        point: [
          `${origin.lat},${origin.lon}`,
          `${destination.lat},${destination.lon}`,
        ].join('&point='),
        vehicle: 'motorcycle',
        locale: 'pt_BR',
        instructions: 'false',
        calc_points: 'false',
        key: apiKey,
      });

      const url = `${ENDPOINT}?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;

      const data: unknown = await res.json();
      const paths = (data as { paths?: Array<{ distance?: number; time?: number }> })?.paths;
      if (!paths || paths.length === 0) return null;

      const path = paths[0];
      if (typeof path.distance !== 'number' || typeof path.time !== 'number') return null;

      return {
        km: path.distance / 1000,
        min: Math.round(path.time / 60000), // GraphHopper retorna milissegundos
        approx: false,
      };
    } catch {
      return null;
    }
  }
}
