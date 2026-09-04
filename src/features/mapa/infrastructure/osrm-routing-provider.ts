/**
 * Provedor de roteamento usando o OSRM público (router.project-osrm.org).
 *
 * É o servidor de demonstração do OSRM — sem garantia de disponibilidade.
 * Quando cai, o chamador deve cair no fallback de linha reta.
 */

import type { GeoPoint, RouteResult, RoutingProvider } from '../domain/routing';

/** Haversine: distância em km entre dois pontos geográficos. */
function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export class OsrmRoutingProvider implements RoutingProvider {
  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null> {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
      const res = await fetch(url);
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

  /** Fallback de linha reta com fator de correção viário (1.3x) + velocidade média urbana. */
  static straightLineRoute(origin: GeoPoint, destination: GeoPoint): RouteResult {
    const km = haversineKm(origin, destination) * 1.3;
    const min = Math.round((km / 28) * 60);
    return { km, min, approx: true };
  }
}
