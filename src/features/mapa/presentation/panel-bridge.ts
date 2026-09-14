/**
 * Ponte de roteamento + geocodificação + mapa para o painel legado.
 *
 * - __motoboyRoute: roteamento (Google → OSRM → linha reta)
 * - __motoboyRouteWithGeometry: roteamento com polyline decodificada
 * - __motoboyGeocoding: busca de endereço e geocodificação reversa
 * - __motoboyMap: mapa Leaflet com marcadores, polylines e ajuste automático
 */

import {
  routingProvider,
  routeWithFallback,
  geocodingProvider,
  cityProvider,
  mapProvider,
  localOsrmProvider,
} from '../index';
import { OsrmRoutingProvider } from '../infrastructure/osrm-routing-provider';
import type {
  GeoPoint,
  RouteResult,
  GeocodingResult,
  ReverseGeocodeResult,
  BrazilianCity,
  MapConfig,
  RouteDisplay,
} from '../index';
import type { RouteResultWithGeometry } from '../infrastructure/osrm-routing-provider';

/** Instância do OSRM para chamadas com geometria. */
const osrmProvider = new OsrmRoutingProvider();

declare global {
  interface Window {
    __motoboyRoute?: (origin: GeoPoint, destination: GeoPoint) => Promise<RouteResult | null>;
    __motoboyRouteWithFallback?: (origin: GeoPoint, destination: GeoPoint) => Promise<RouteResult>;
    __motoboyRouteWithGeometry?: (
      origin: GeoPoint,
      destination: GeoPoint,
    ) => Promise<RouteResultWithGeometry | null>;
    __motoboyRouteChainWithGeometry?: (
      points: GeoPoint[],
    ) => Promise<{
      totalKm: number;
      totalMin: number;
      approx: boolean;
      segments: RouteResultWithGeometry[];
    } | null>;
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
      addMarker(point: GeoPoint, label?: string, options?: { color?: string; draggable?: boolean }): void;
      addNumberedMarker(point: GeoPoint, number: number, label?: string): void;
      clearMarkers(): void;
      drawRoute(display: RouteDisplay): void;
      drawPolyline(coordinates: GeoPoint[], options?: { color?: string; weight?: number; opacity?: number }): void;
      clearRoutes(): void;
      fitAllMarkers(): void;
      fitAll(): void;
      invalidateSize(): void;
      addPositionMarker(point: GeoPoint, accuracy?: number): void;
      centerOnPosition(point: GeoPoint, zoom?: number): void;
      removePositionMarker(): void;
      destroy(): void;
    };
    __motoboyOfflineRouting?: {
      isLocalAvailable(): boolean;
      resetLocalCheck(): void;
    };
  }
}

export function installMapaBridge(): void {
  // Roteamento com fallback (Google → OSRM → linha reta)
  window.__motoboyRoute = (origin, destination) => routingProvider.route(origin, destination);
  // Roteamento que SEMPRE retorna resultado (nunca null)
  window.__motoboyRouteWithFallback = (origin, destination) => routeWithFallback(origin, destination);
  // Roteamento com geometria (polyline decodificada do OSRM)
  window.__motoboyRouteWithGeometry = (origin, destination) =>
    osrmProvider.routeWithGeometry(origin, destination);
  // Rota em cadeia com geometria (para mapa na criação de rota)
  window.__motoboyRouteChainWithGeometry = (points) =>
    osrmProvider.routeChainWithGeometry(points);
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
  // Mapa Leaflet (gratuito) — com suporte a polylines e marcadores numerados
  window.__motoboyMap = {
    create: (config) => mapProvider.create(config),
    setCenter: (point, zoom) => mapProvider.setCenter(point, zoom),
    addMarker: (point, label, options) => mapProvider.addMarker(point, label, options),
    addNumberedMarker: (point, number, label) => mapProvider.addNumberedMarker(point, number, label),
    clearMarkers: () => mapProvider.clearMarkers(),
    drawRoute: (display) => mapProvider.drawRoute(display),
    drawPolyline: (coordinates, options) => mapProvider.drawPolyline(coordinates, options),
    clearRoutes: () => mapProvider.clearRoutes(),
    fitAllMarkers: () => mapProvider.fitAllMarkers(),
    fitAll: () => mapProvider.fitAll(),
    invalidateSize: () => mapProvider.invalidateSize(),
    addPositionMarker: (point, accuracy) => mapProvider.addPositionMarker(point, accuracy),
    centerOnPosition: (point, zoom) => mapProvider.centerOnPosition(point, zoom),
    removePositionMarker: () => mapProvider.removePositionMarker(),
    destroy: () => mapProvider.destroy(),
  };
  // Status de roteamento offline (OSRM local)
  window.__motoboyOfflineRouting = {
    isLocalAvailable: () => localOsrmProvider.isAvailable(),
    resetLocalCheck: () => localOsrmProvider.resetAvailability(),
  };
}
