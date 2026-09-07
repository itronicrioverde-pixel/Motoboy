/**
 * Composition root da feature Mapa/Roteamento.
 *
 * Cadeia de roteamento: OSRM (gratuito) → GraphHopper (gratuito tier) → linha reta.
 * Geocodificação: Photon + Nominatim (city-aware, ranking de resultados).
 * Reverse geocoding: Photon → Nominatim (fallback).
 * Cidades: IBGE (todas as ~5.570 cidades do Brasil).
 * Mapa: Leaflet.js + OpenStreetMap.
 *
 * Tudo gratuito, sem chave obrigatória. GraphHopper opcional (500 req/dia grátis).
 */

import { OsrmRoutingProvider } from './infrastructure/osrm-routing-provider';
import { GraphHopperRoutingProvider } from './infrastructure/graphhopper-routing-provider';
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

/** Roteamento composto: OSRM → GraphHopper → linha reta. */
export const routingProvider = new CompositeRoutingProvider([
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

export type { GeoPoint, RouteResult } from './domain/routing';
export type { GeocodingResult, RegionPlace, ReverseGeocodeResult, GeocodingProvider } from './domain/geocoding';
export type { BrazilianCity, CityProvider } from './domain/cities';
export type { MapConfig, RouteDisplay } from './infrastructure/leaflet-map-provider';
