/**
 * Composition root da feature Mapa/Roteamento.
 *
 * Cadeia de roteamento: Google Routes API (se chave existir) → OSRM → linha reta.
 * Geocodificação: Photon (komoot.io).
 * Cidades: IBGE (todas as ~5.570 cidades do Brasil).
 * Mapa: Leaflet.js + OpenStreetMap.
 *
 * Tudo gratuito, sem chave, sem cartão de crédito.
 */

import { GoogleRoutesProvider } from './infrastructure/google-routes-provider';
import { OsrmRoutingProvider } from './infrastructure/osrm-routing-provider';
import { CompositeRoutingProvider } from './infrastructure/composite-routing-provider';
import { PhotonGeocodingProvider } from './infrastructure/photon-geocoding-provider';
import { IbgeCityProvider } from './infrastructure/ibge-city-provider';
import { LeafletMapProvider } from './infrastructure/leaflet-map-provider';

/** Roteamento composto: Google (se chave) → OSRM → linha reta. */
export const routingProvider = new CompositeRoutingProvider([
  new GoogleRoutesProvider(() => import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
  new OsrmRoutingProvider(),
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

/** Photon geocodificação (busca de endereço + reverse geocode). */
export const geocodingProvider = new PhotonGeocodingProvider();

/** Cidades brasileiras via IBGE (gratuito). */
export const cityProvider = new IbgeCityProvider();

/** Mapa Leaflet (gratuito). */
export const mapProvider = new LeafletMapProvider();

export type { GeoPoint, RouteResult } from './domain/routing';
export type { GeocodingResult, RegionPlace, ReverseGeocodeResult, GeocodingProvider } from './domain/geocoding';
export type { BrazilianCity, CityProvider } from './domain/cities';
export type { MapConfig, RouteDisplay } from './infrastructure/leaflet-map-provider';
