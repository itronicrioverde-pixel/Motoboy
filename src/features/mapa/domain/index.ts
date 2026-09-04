/**
 * API pública do domínio Mapa/Roteamento. Sem default export.
 */

export type { GeoPoint, RouteResult, RoutingProvider } from './routing';
export type {
  GeocodingResult,
  RegionPlace,
  ReverseGeocodeResult,
  GeocodingProvider,
} from './geocoding';
export type { BrazilianCity, CityProvider } from './cities';
