/**
 * Ponte de roteamento + geocodificação para o painel legado.
 *
 * - __motoboyRoute: roteamento (Google → OSRM → linha reta)
 * - __motoboyGeocoding: busca de endereço e geocodificação reversa
 */

import {
  routingProvider,
  routeWithFallback,
  geocodingProvider,
  cityProvider,
  mapProvider,
} from '../index';
import type {
  GeoPoint,
  RouteResult,
  GeocodingResult,
  ReverseGeocodeResult,
  BrazilianCity,
  MapConfig,
  RouteDisplay,
} from '../index';

declare global {
  interface Window {
    __motoboyRoute?: (origin: GeoPoint, destination: GeoPoint) => Promise<RouteResult | null>;
    __motoboyRouteWithFallback?: (origin: GeoPoint, destination: GeoPoint) => Promise<RouteResult>;
    __motoboyGeocoding?: {
      search(query: string, limit: number, center?: GeoPoint): Promise<readonly GeocodingResult[]>;
      reverse(point: GeoPoint): Promise<ReverseGeocodeResult | null>;
    };
    __motoboyCities?: {
      listAll(): Promise<readonly BrazilianCity[]>;
      search(query: string, limit?: number): Promise<readonly BrazilianCity[]>;
      listByState(state: string): Promise<readonly BrazilianCity[]>;
    };
    __motoboyMap?: {
      create(config: MapConfig): void;
      setCenter(point: GeoPoint, zoom?: number): void;
      addMarker(point: GeoPoint, label?: string): void;
      clearMarkers(): void;
      drawRoute(display: RouteDisplay): void;
      clearRoutes(): void;
      fitAllMarkers(): void;
      destroy(): void;
    };
  }
}

export function installMapaBridge(): void {
  // Roteamento com fallback (Google → OSRM → linha reta)
  window.__motoboyRoute = (origin, destination) => routingProvider.route(origin, destination);
  // Roteamento que SEMPRE retorna resultado (nunca null)
  window.__motoboyRouteWithFallback = (origin, destination) => routeWithFallback(origin, destination);
  // Geocodificação via Photon (gratuito)
  window.__motoboyGeocoding = {
    search: (query, limit, center) => geocodingProvider.search(query, limit, center),
    reverse: (point) => geocodingProvider.reverseGeocode(point),
  };
  // Cidades brasileiras via IBGE (gratuito)
  window.__motoboyCities = {
    listAll: () => cityProvider.listAll(),
    search: (query, limit) => cityProvider.search(query, limit),
    listByState: (state) => cityProvider.listByState(state),
  };
  // Mapa Leaflet (gratuito)
  window.__motoboyMap = {
    create: (config) => mapProvider.create(config),
    setCenter: (point, zoom) => mapProvider.setCenter(point, zoom),
    addMarker: (point, label) => mapProvider.addMarker(point, label),
    clearMarkers: () => mapProvider.clearMarkers(),
    drawRoute: (display) => mapProvider.drawRoute(display),
    clearRoutes: () => mapProvider.clearRoutes(),
    fitAllMarkers: () => mapProvider.fitAllMarkers(),
    destroy: () => mapProvider.destroy(),
  };
}
