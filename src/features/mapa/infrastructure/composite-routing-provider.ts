/**
 * Provedor de roteamento composto: tenta Google Routes, depois OSRM,
 * e por último linha reta com fator de correção viário.
 *
 * Cada provedor pode retornar null (indisponível), e o próximo entra como fallback.
 */

import type { GeoPoint, RouteResult, RoutingProvider } from '../domain/routing';
import { OsrmRoutingProvider } from './osrm-routing-provider';

export class CompositeRoutingProvider implements RoutingProvider {
  constructor(
    private readonly providers: readonly RoutingProvider[],
  ) {}

  async route(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null> {
    for (const provider of this.providers) {
      try {
        const result = await provider.route(origin, destination);
        if (result) return result;
      } catch {
        // tenta o próximo provedor
      }
    }
    return null;
  }

  /**
   * Rota com fallback completo: Google → OSRM → linha reta.
   * Útil para quando o chamador PRECISA de um resultado (não aceita null).
   */
  static async routeWithFallback(
    googleProvider: RoutingProvider,
    origin: GeoPoint,
    destination: GeoPoint,
  ): Promise<RouteResult> {
    // 1) Google Routes API
    try {
      const googleResult = await googleProvider.route(origin, destination);
      if (googleResult) return googleResult;
    } catch {
      // segue para o OSRM
    }

    // 2) OSRM (fallback gratuito)
    const osrm = new OsrmRoutingProvider();
    try {
      const osrmResult = await osrm.route(origin, destination);
      if (osrmResult) return osrmResult;
    } catch {
      // segue para a linha reta
    }

    // 3) Linha reta com fator de correção viário
    return OsrmRoutingProvider.straightLineRoute(origin, destination);
  }
}
