/**
 * Provedor de geocodificação HERE Maps (freemium).
 *
 * Vantagem sobre Photon/Nominatim: dados proprietários com cobertura
 * completa de ruas brasileiras (incluindo cidades pequenas onde o OSM é incompleto).
 *
 * Free tier: 250.000 requests/mês.
 * API: https://developer.here.com/documentation/geocoding-search-api/dev_guide/index.html
 */

import type {
  GeocodingProvider,
  GeocodingResult,
  ReverseGeocodeResult,
} from '../domain/geocoding';
import type { GeoPoint } from '../domain/routing';

const API_KEY = import.meta.env.VITE_HERE_API_KEY as string | undefined;

function available(): boolean {
  return !!API_KEY;
}

function buildLabel(v: Record<string, unknown>): string {
  const parts: string[] = [];
  const street = v.street as string | undefined;
  const number = v.housenumber as string | undefined;
  if (street) parts.push(number ? `${street}, ${number}` : street as string);
  const district = v.district as string | undefined;
  const city = (v.city || v.county || v.locality) as string | undefined;
  if (district && district !== city) parts.push(district);
  if (city) parts.push(city);
  const state = v.state as string | undefined;
  if (state) parts.push(state);
  return parts.slice(0, 4).join(', ') || (v.label as string) || 'Endereço';
}

/**
 * Autocomplete HERE: rápido, aceita endereços parciais,
 * retorna dados com街名/número mesmo para cidades pequenas do Brasil.
 */
async function hereAutocomplete(
  query: string,
  limit: number,
  center?: GeoPoint,
): Promise<GeocodingResult[]> {
  if (!API_KEY) return [];
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 20)),
    apiKey: API_KEY,
    countrycode: 'BRA',
    results: 'addresses',
  });
  if (center) {
    params.set('at', `${center.lat},${center.lon}`);
  }
  const res = await fetch(
    `https://autocomplete.search.hereapi.com/v1/autocomplete?${params}`,
  );
  if (!res.ok) return [];
  const data = await res.json();
  const items: unknown[] = data.items ?? [];
  return items
    .map((item: any) => {
      const addr = item.address ?? {};
      return {
        label: item.title || buildLabel(addr),
        lat: item.position?.lat ?? 0,
        lon: item.position?.lon ?? 0,
      };
    })
    .filter((r) => r.lat !== 0 && r.lon !== 0);
}

/**
 * Geocoding exato HERE: converte endereço completo em coordenadas.
 */
async function hereGeocode(
  query: string,
  limit: number,
  center?: GeoPoint,
): Promise<GeocodingResult[]> {
  if (!API_KEY) return [];
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 10)),
    apiKey: API_KEY,
    countrycode: 'BRA',
  });
  if (center) {
    params.set('at', `${center.lat},${center.lon}`);
  }
  const res = await fetch(
    `https://geocode.search.hereapi.com/v1/geocode?${params}`,
  );
  if (!res.ok) return [];
  const data = await res.json();
  const items: unknown[] = data.items ?? [];
  return items
    .map((item: any) => {
      const addr = item.address ?? {};
      return {
        label: item.title || buildLabel(addr),
        lat: item.position?.lat ?? 0,
        lon: item.position?.lon ?? 0,
      };
    })
    .filter((r) => r.lat !== 0 && r.lon !== 0);
}

/**
 * Reverse geocoding HERE: coordenadas → endereço.
 */
async function hereReverse(lat: number, lon: number): Promise<ReverseGeocodeResult | null> {
  if (!API_KEY) return null;
  const params = new URLSearchParams({
    at: `${lat},${lon}`,
    apiKey: API_KEY,
    lang: 'pt',
  });
  const res = await fetch(
    `https://geocode.search.hereapi.com/v1/geocode?${params}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const first = data.items?.[0];
  if (!first) return null;
  const addr = first.address ?? {};
  return {
    city: addr.city || addr.county || addr.district || '',
    state: addr.state || null,
  };
}

/**
 * Provedor de geocodificação HERE Maps.
 * Implementa GeocodingProvider com autocomplete + geocode + reverse.
 */
export const hereGeocodingProvider: GeocodingProvider = {
  async search(
    query: string,
    limit: number,
    center?: GeoPoint,
  ): Promise<readonly GeocodingResult[]> {
    if (!available()) return [];

    try {
      const [autocompleteResults, geocodeResults] = await Promise.all([
        hereAutocomplete(query, limit, center).catch(() => []),
        hereGeocode(query, limit, center).catch(() => []),
      ]);

      // Merge sem duplicatas (mesma lat/lon)
      const seen = new Set<string>();
      const merged: GeocodingResult[] = [];
      for (const r of [...geocodeResults, ...autocompleteResults]) {
        const key = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(r);
        }
      }
      return merged.slice(0, limit);
    } catch {
      return [];
    }
  },

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    if (!available()) return null;
    try {
      return await hereReverse(point.lat, point.lon);
    } catch {
      return null;
    }
  },
};
