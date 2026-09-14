/**
 * Provedor de roteamento usando o OSRM público (router.project-osrm.org).
 *
 * É o servidor de demonstração do OSRM — sem garantia de disponibilidade.
 * Quando cai, o chamador deve cair no fallback de linha reta.
 *
 * Suporta retorno de geometria (polyline) quando solicitado.
 */

import type { GeoPoint, RouteResult, RoutingProvider } from '../domain/routing';
import { decodePolyline } from './polyline-decoder';

/** Resultado de rota com geometria (polyline decodificada). */
export interface RouteResultWithGeometry extends RouteResult {
  /** Pontos da polyline decodificada (se overview=full). */
  geometry?: GeoPoint[];
}

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
  constructor(
    private readonly timeoutMs = 8000,
    private readonly baseUrl = 'https://router.project-osrm.org',
  ) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null> {
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

  /** Rota com geometria (polyline decodificada). */
  async routeWithGeometry(
    origin: GeoPoint,
    destination: GeoPoint,
  ): Promise<RouteResultWithGeometry | null> {
    try {
      const url = `${this.baseUrl}/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=polyline`;
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const routes = (data as {
        routes?: Array<{
          distance?: number;
          duration?: number;
          geometry?: string;
        }>;
      })?.routes;
      if (!routes || routes.length === 0) return null;

      const route = routes[0];
      const geometry = route.geometry ? decodePolyline(route.geometry) : undefined;

      return {
        km: route.distance! / 1000,
        min: Math.round(route.duration! / 60),
        approx: false,
        geometry,
      };
    } catch {
      return null;
    }
  }

  /** Rota em cadeia com geometria (vários pontos sequenciais). */
  async routeChainWithGeometry(
    points: GeoPoint[],
  ): Promise<{ totalKm: number; totalMin: number; approx: boolean; segments: RouteResultWithGeometry[] } | null> {
    if (points.length < 2) return null;

    const segments: RouteResultWithGeometry[] = [];
    let totalKm = 0;
    let totalMin = 0;
    let anyApprox = false;

    for (let i = 0; i < points.length - 1; i++) {
      const result = await this.routeWithGeometry(points[i], points[i + 1]);
      if (!result) {
        const fallback = OsrmRoutingProvider.straightLineRoute(points[i], points[i + 1]);
        segments.push({ ...fallback, geometry: [points[i], points[i + 1]] });
        totalKm += fallback.km;
        totalMin += fallback.min;
        anyApprox = true;
      } else {
        segments.push(result);
        totalKm += result.km;
        totalMin += result.min;
        if (result.approx) anyApprox = true;
      }
    }

    return { totalKm, totalMin, approx: anyApprox, segments };
  }

  /** Fallback de linha reta com fator de correção viário (1.3x) + velocidade média urbana. */
  static straightLineRoute(origin: GeoPoint, destination: GeoPoint): RouteResult {
    const km = haversineKm(origin, destination) * 1.3;
    const min = Math.round((km / 28) * 60);
    return { km, min, approx: true };
  }
}
