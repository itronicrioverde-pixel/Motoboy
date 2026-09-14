/**
 * Provedor de roteamento usando OSRM local (self-hosted).
 *
 * Para usar offline, o motoboy pode rodar um container Docker com OSRM:
 *   docker run -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend \
 *     osrm-routed --algorithm mld /data/region.osrm
 *
 * O arquivo .osrm é gerado a partir de dados OSM regionais (ex: sudeste-latest.osm.pbf).
 *
 * Este provedor verifica se o servidor local está disponível antes de usar.
 * Se não estiver, retorna null para o próximo provedor assumir.
 */

import type { GeoPoint, RouteResult, RoutingProvider } from '../domain/routing';

export class LocalOsrmRoutingProvider implements RoutingProvider {
  private available: boolean | null = null;
  private checking = false;

  constructor(
    private readonly baseUrl = 'http://localhost:5000',
    private readonly timeoutMs = 3000,
  ) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null> {
    // Se já verificamos e o servidor não está disponível, retorna null
    if (this.available === false) return null;

    // Verifica disponibilidade (uma única vez)
    if (this.available === null && !this.checking) {
      this.checking = true;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${this.baseUrl}/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        this.available = res.ok;
      } catch {
        this.available = false;
      }
      this.checking = false;
    }

    if (!this.available) return null;

    try {
      const url = `${this.baseUrl}/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const routes = (data as { routes?: Array<{ distance?: number; duration?: number }> })?.routes;
      if (!routes || routes.length === 0) return null;

      return {
        km: routes[0].distance! / 1000,
        min: Math.round(routes[0].duration! / 60),
        approx: false,
      };
    } catch {
      return null;
    }
  }

  /** Reseta o cache de disponibilidade (útil para retry manual). */
  resetAvailability(): void {
    this.available = null;
  }

  /** Retorna se o servidor local está disponível. */
  isAvailable(): boolean {
    return this.available === true;
  }
}
