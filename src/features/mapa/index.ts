/**
 * Composition root da feature Mapa/Roteamento.
 *
 * Cadeia de roteamento: OSRM local (offline) → OSRM público → GraphHopper → linha reta.
 * Geocodificação: Photon + Nominatim (city-aware, ranking de resultados).
 * Reverse geocoding: Photon → Nominatim (fallback).
 * Cidades: IBGE (todas as ~5.570 cidades do Brasil).
 * Mapa: Leaflet.js + OpenStreetMap.
 *
 * Tudo gratuito, sem chave obrigatória. GraphHopper opcional (500 req/dia grátis).
 * OSRM local opcional (Docker, para uso offline).
 */

import { OsrmRoutingProvider } from './infrastructure/osrm-routing-provider';
import { GraphHopperRoutingProvider } from './infrastructure/graphhopper-routing-provider';
import { LocalOsrmRoutingProvider } from './infrastructure/local-osrm-routing-provider';
import { CompositeRoutingProvider } from './infrastructure/composite-routing-provider';
import { PhotonGeocodingProvider } from './infrastructure/photon-geocoding-provider';
import { IbgeCityProvider } from './infrastructure/ibge-city-provider';
import { LeafletMapProvider } from './infrastructure/leaflet-map-provider';

/** Função para obter chave GraphHopper do ambiente. */
function getGraphHopperKey(): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GRAPHHOPPER_API_KEY;
  } catch {
    return undefined;
  }
}

/** Função para obter URL do OSRM local do ambiente. */
function getLocalOsrmUrl(): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LOCAL_OSRM_URL;
  } catch {
    return undefined;
  }
}

/** OSRM local (self-hosted, offline). */
const localOsrmProvider = new LocalOsrmRoutingProvider(
  getLocalOsrmUrl() || 'http://localhost:5000',
);

/**
 * Roteamento composto: OSRM local → OSRM público → GraphHopper → linha reta.
 *
 * Quando o motoboy está sem internet, o OSRM local assume automaticamente.
 * Quando ele volta a ter internet, os provedores públicos retomam.
 */
export const routingProvider = new CompositeRoutingProvider([
  localOsrmProvider,
  new OsrmRoutingProvider(),
  new GraphHopperRoutingProvider(getGraphHopperKey),
]);

/** Rota com fallback completo (sempre retorna resultado, nunca null). */
export async function routeWithFallback(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
): Promise<{ km: number; min: number; approx: boolean }> {
  const result = await routingProvider.route(origin, destination);
  if (result) return result;
  // Último recurso: linha reta com fator de correção viário
  return OsrmRoutingProvider.straightLineRoute(origin, destination);
}

/** Photon geocodificação (busca de endereço + reverse geocode, city-aware). */
export const geocodingProvider = new PhotonGeocodingProvider();

/** Cidades brasileiras via IBGE (gratuito). */
export const cityProvider = new IbgeCityProvider();

/** Mapa Leaflet (gratuito). */
export const mapProvider = new LeafletMapProvider();

/** Acesso ao provedor local (para status/retry). */
export { localOsrmProvider };

export type { GeoPoint, RouteResult } from './domain/routing';
export type { GeocodingResult, RegionPlace, ReverseGeocodeResult, GeocodingProvider } from './domain/geocoding';
export type { BrazilianCity, CityProvider } from './domain/cities';
export type { MapConfig, RouteDisplay } from './infrastructure/leaflet-map-provider';
export type { RouteResultWithGeometry } from './infrastructure/osrm-routing-provider';
