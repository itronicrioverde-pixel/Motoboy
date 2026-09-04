/**
 * Provedor de geocodificação usando o Photon (komoot.io).
 *
 * O Photon é feito para "search-as-you-type" — diferente do Nominatim que
 * proíbe esse uso. Sem chave de API: é gratuito e aberto.
 */

import type {
  GeocodingProvider,
  GeocodingResult,
  ReverseGeocodeResult,
} from '../domain/geocoding';
import type { GeoPoint } from '../domain/routing';

/** Monta um bbox ~30km ao redor de um ponto. */
function regionBbox(center: GeoPoint, delta = 0.3): string {
  return `${center.lon - delta},${center.lat - delta},${center.lon + delta},${center.lat + delta}`;
}

function formatLabel(props: Record<string, unknown>): string {
  const parts = [props.name, props.street, props.district, props.city, props.state].filter(Boolean);
  return [...new Set(parts)].slice(0, 4).join(', ');
}

export class PhotonGeocodingProvider implements GeocodingProvider {
  async search(query: string, limit: number, center?: GeoPoint): Promise<readonly GeocodingResult[]> {
    if (!query.trim()) return [];

    const fetchLimit = Math.min(limit + 8, 20);
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${fetchLimit}&lang=default`;
    if (center) url += `&bbox=${encodeURIComponent(regionBbox(center))}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data: unknown = await res.json();
      const features = (data as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }> })
        ?.features ?? [];

      return features
        .filter((f) => {
          const props = f.properties;
          return props && props.countrycode === 'BR';
        })
        .slice(0, limit)
        .map((f) => ({
          label: formatLabel(f.properties ?? {}),
          lat: f.geometry?.coordinates?.[1] ?? 0,
          lon: f.geometry?.coordinates?.[0] ?? 0,
        }));
    } catch {
      return [];
    }
  }

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    try {
      const url = `https://photon.komoot.io/reverse/?lon=${point.lon}&lat=${point.lat}&lang=default`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const props = (data as { features?: Array<{ properties?: Record<string, unknown> }> })
        ?.features?.[0]?.properties;
      if (props && typeof props.city === 'string' && props.city.length > 0) {
        return {
          city: props.city,
          state: typeof props.state === 'string' ? props.state : null,
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
