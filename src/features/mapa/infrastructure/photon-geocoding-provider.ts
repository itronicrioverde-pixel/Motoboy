/**
 * Provedor de geocodificação com DUAS fontes gratuitas:
 *
 * 1. Photon (komoot.io) — feito para "search-as-you-type".
 * 2. Nominatim (openstreetmap.org) — mesmo dado OSM, índice diferente;
 *    acha ruas/bairros que o Photon perde em cidades pequenas.
 *
 * Melhorias sobre a versão anterior:
 * - City-aware filtering: quando a cidade do usuário é conhecida,
 *   prioriza resultados dessa cidade e appenda cidade na busca.
 * - Result ranking: ruas > bairros > cidades > POIs, mesma cidade primeiro.
 * - Reverse geocoding com fallback Nominatim.
 * - Busca por bairro/referência (comum no Brasil).
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

function formatLabel(p: Record<string, unknown>): string {
  const city = p.city || p.county || p.locality;
  if (p.street) {
    const rua = p.housenumber ? `${p.street}, ${p.housenumber}` : p.street;
    const local = [p.district, city].filter(Boolean);
    return [rua, ...local].slice(0, 3).join(', ');
  }
  const local = [p.district, city].filter(Boolean);
  return [p.name, ...local].filter(Boolean).slice(0, 3).join(', ') || 'Endereço';
}

interface GeoFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: number[] };
}

/** Tira números soltos: "popular 78 569" → "popular". */
function streetWords(query: string): string {
  return query.trim().split(/\s+/).filter((w) => !/^\d+$/.test(w)).join(' ');
}

/** Extrai palavras significativas (>= 3 chars) de uma query. */
function significantWords(query: string): string[] {
  return query.trim().split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)).map(norm);
}

/** Match forte: keyword aparece no nome/rua/valor-osm do feature. */
function hasStrongMatch(props: Record<string, unknown>, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const streetFields = [props.street, props.housenumber]
    .filter((v): v is string => typeof v === 'string').map(norm);
  const nameField = typeof props.name === 'string' ? norm(props.name) : '';
  const osmValue = typeof props.osm_value === 'string' ? norm(props.osm_value) : '';
  return keywords.some((kw) => {
    const inStreet = streetFields.some((c) => c.includes(kw));
    const inName = nameField.includes(kw);
    const inOsm = osmValue.includes(kw);
    return inStreet || inName || inOsm;
  });
}

/** Normaliza string para comparação (lowercase, sem acento básico). */
function norm(s: string): string {
  return s.toLowerCase().trim();
}

/** Verifica se um feature é da mesma cidade que o usuário. */
function isSameCity(props: Record<string, unknown>, userCity: string | null): boolean {
  if (!userCity) return true;
  // POIs (lojas, restaurantes) têm coordenadas válidas mesmo sem campo city — não filtra
  const osmKey = typeof props.osm_key === 'string' ? props.osm_key.toLowerCase() : '';
  if (['shop', 'amenity', 'leisure', 'commercial', 'retail', 'tourism'].includes(osmKey)) return true;
  const alvo = norm(userCity);
  const candidatos = [props.city, props.county, props.locality, props.district]
    .filter((v): v is string => typeof v === 'string')
    .map(norm);
  return candidatos.includes(alvo);
}

/** Detecta se o feature pertence à categoria de POI buscada. */
function categoryMatch(props: Record<string, unknown>, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const osmVal = typeof props.osm_value === 'string' ? norm(props.osm_value) : '';
  const name = typeof props.name === 'string' ? norm(props.name) : '';
  return keywords.some((kw) => {
    if (osmVal && osmVal.includes(kw)) return true;
    if (name && name.includes(kw)) return true;
    return false;
  });
}

/**
 * Ranking de tipo de resultado (menor = melhor).
 * Ruas e casas são mais específicas que bairros ou cidades.
 * POIs com match forte no nome ficam entre rua e bairro.
 */
function typeRank(props: Record<string, unknown>, hasStrongNameMatch = false, isCategoryMatch = false): number {
  const t = String(props.type ?? '').toLowerCase();
  if (t === 'house' || t === 'street') return 0;
  // POIs (lojas, restaurantes) com match forte ou de categoria → entre rua e bairro
  if ((hasStrongNameMatch || isCategoryMatch) && isPOI(props)) return 0.5;
  if (t === 'district' || t === 'suburb' || t === 'neighbourhood') return 1;
  if (t === 'city' || t === 'town' || t === 'village') return 2;
  if (t === 'state') return 3;
  return 4; // POIs sem match forte e outros
}

/** Verifica se um feature é um POI (loja, restaurante, etc.). */
function isPOI(props: Record<string, unknown>): boolean {
  const t = String(props.type ?? '').toLowerCase();
  if (['shop', 'amenity', 'leisure', 'commercial', 'retail', 'tourism'].includes(t)) return true;
  // Photon retorna osm_key e osm_value como campos separados
  const osmKey = String(props.osm_key ?? '').toLowerCase();
  const osmValue = String(props.osm_value ?? '').toLowerCase();
  if (['shop', 'amenity', 'leisure', 'commercial', 'retail', 'tourism'].includes(osmKey)) return true;
  // Lojas e restaurante específicos
  const poiValues = ['pharmacy', 'restaurant', 'cafe', 'bar', 'bakery', 'supermarket',
    'convenience', 'clothes', 'electronics', 'hairdresser', 'car_repair', 'fuel'];
  if (poiValues.includes(osmValue)) return true;
  return false;
}

/**
 * Calcula score de um feature para ordenação.
 * Menor score = melhor resultado.
 */
function rankScore(
  props: Record<string, unknown>,
  userCity: string | null,
  userCoords: GeoPoint | null,
  keywords: string[] = [],
): number {
  const strongMatch = keywords.length > 0 && hasStrongMatch(props, keywords);
  const catMatch = keywords.length > 0 && categoryMatch(props, keywords);
  let score = typeRank(props, strongMatch, catMatch);

  // Bônus: mesma cidade
  if (userCity && isSameCity(props, userCity)) {
    score -= 10;
  } else if (userCity) {
    score += 10;
  }

  // Bônus: proximidade ao GPS
  if (userCoords) {
    const lat = Number(props.lat ?? (props as Record<string, unknown>).latitude);
    const lon = Number(props.lon ?? (props as Record<string, unknown>).longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const dlat = Math.abs(lat - userCoords.lat);
      const dlon = Math.abs(lon - userCoords.lon);
      const dist = dlat + dlon;
      if (dist < 0.05) score -= 5;      // < ~5km
      else if (dist < 0.1) score -= 3;  // < ~10km
      else if (dist < 0.3) score -= 1;  // < ~30km
    }
  }

  return score;
}

export class PhotonGeocodingProvider implements GeocodingProvider {
  /** Cidade conhecida do usuário (atualizada por reverse geocode). */
  private userCity: string | null = null;

  /** Define a cidade do usuário para city-aware filtering. */
  setUserCity(city: string | null): void {
    this.userCity = city;
  }

  /** Retorna a cidade conhecida do usuário. */
  getUserCity(): string | null {
    return this.userCity;
  }

  async search(query: string, limit: number, center?: GeoPoint): Promise<readonly GeocodingResult[]> {
    if (!query.trim()) return [];

    const fetchLimit = Math.min(limit + 12, 20);
    const nomeRua = streetWords(query);
    const city = this.userCity;
    const keywords = significantWords(query);

    /** Busca Photon com ou sem filtro de POI. */
    const photon = async (q: string, c: GeoPoint | null, osmTag?: string): Promise<GeoFeature[]> => {
      let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${fetchLimit}&lang=default`;
      if (c) url += `&bbox=${encodeURIComponent(regionBbox(c))}`;
      // Photon aceita múltiplos osm_tag como parâmetros separados
      if (osmTag) {
        const tags = osmTag.split('|');
        for (const tag of tags) {
          url += `&osm_tag=${encodeURIComponent(tag)}`;
        }
      }
      const res = await fetch(url);
      if (!res.ok) return [];
      const data: unknown = await res.json();
      return ((data as { features?: GeoFeature[] })?.features ?? []).filter(
        (f) => f.properties && f.properties.countrycode === 'BR',
      );
    };

    const nominatim = async (q: string): Promise<GeoFeature[]> => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=br&limit=${fetchLimit}&addressdetails=1&format=json`;
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data: unknown = await res.json();
        return (Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [])
          .map((item) => {
            const a = (item.address ?? {}) as Record<string, string>;
            const cidade = a.city || a.town || a.village || a.municipality || a.suburb;
            const lon = Number(item.lon);
            const lat = Number(item.lat);
            return {
              properties: {
                type: a.road ? 'street' : (a.suburb || a.neighbourhood ? 'district' : 'other'),
                name: item.name ?? null,
                street: a.road ?? null,
                housenumber: a.house_number ?? null,
                district: a.suburb || a.neighbourhood || a.city_district || null,
                city: cidade ?? null,
                county: a.county ?? null,
                state: a.state ?? null,
                countrycode: (a.country_code || 'br').toUpperCase(),
                lat,
                lon,
              },
              geometry: { coordinates: [lon, lat] },
            } as GeoFeature;
          })
          .filter((f) => (f.properties?.countrycode as string | undefined) === 'BR'
            && Number.isFinite(f.geometry?.coordinates?.[1]));
      } catch {
        return [];
      }
    };

    /** Mescla sem duplicar (mesmo nome + mesma cidade). */
    const merge = (fot: GeoFeature[], nom: GeoFeature[]): GeoFeature[] => {
      const vistos = new Set(fot.map((f) => {
        const p = f.properties ?? {};
        return `${(p.name || p.street || '').toString().toLowerCase()}|${(p.city || p.county || '').toString().toLowerCase()}`;
      }));
      return fot.concat(nom.filter((f) => {
        const p = f.properties ?? {};
        const chave = `${(p.name || p.street || '').toString().toLowerCase()}|${(p.city || p.county || '').toString().toLowerCase()}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      }));
    };

    /** Ordena por ranking (mesma cidade primeiro, tipo específico primeiro, proximidade). */
    const rankAndSlice = (features: GeoFeature[]): GeoFeature[] => {
      return features
        .map((f) => ({
          feature: f,
          score: rankScore(f.properties ?? {}, city, center ?? null, keywords),
        }))
        .sort((a, b) => a.score - b.score)
        .map((s) => s.feature)
        .slice(0, limit);
    };

    try {
      // 1) Busca dupla: query normal + query com filtro POI (lojas, restaurantes, etc.)
      const [normalResults, poiResults] = await Promise.all([
        photon(query, center ?? null),
        photon(query, center ?? null, 'shop|amenity|leisure'),
      ]);
      let features = merge(normalResults, poiResults);

      // Adiciona resultados do Nominatim
      const nomResults = await nominatim(query);
      features = merge(features, nomResults);

      // 2) Filtro inteligente: se temos resultados mas NENHUM tem match forte
      //    (keyword só em bairro/cidade, não em rua/nome), busca com rua limpa.
      const hasStrong = features.some((f) => hasStrongMatch(f.properties ?? {}, keywords));
      if (!hasStrong && nomeRua !== query.trim()) {
        const [strippedNormal, strippedPOI] = await Promise.all([
          photon(nomeRua, center ?? null),
          photon(nomeRua, center ?? null, 'shop|amenity|leisure'),
        ]);
        const strippedFeatures = merge(strippedNormal, strippedPOI);
        features = merge(features, merge(strippedFeatures, await nominatim(nomeRua)));
        // Se ainda não tem match forte, busca com cidade appended
        if (!features.some((f) => hasStrongMatch(f.properties ?? {}, keywords))) {
          if (city) {
            const [cityNormal, cityPOI] = await Promise.all([
              photon(`${nomeRua}, ${city}`, center ?? null),
              photon(`${nomeRua}, ${city}`, center ?? null, 'shop|amenity|leisure'),
            ]);
            const cityFeatures = merge(cityNormal, cityPOI);
            features = merge(features, merge(cityFeatures, await nominatim(`${nomeRua}, ${city}`)));
          }
        }
      }

      // 3) Se temos cidade conhecida e poucos resultados, busca com cidade appended
      if (city && features.length < 3) {
        const queryComCidade = `${query}, ${city}`;
        const [extraNormal, extraPOI] = await Promise.all([
          photon(queryComCidade, center ?? null),
          photon(queryComCidade, center ?? null, 'shop|amenity|leisure'),
        ]);
        const extraPhoton = merge(extraNormal, extraPOI);
        const extraNominatim = await nominatim(queryComCidade);
        features = merge(features, merge(extraPhoton, extraNominatim));
      }

      // 4) sem bbox (GPS negado ou endereço de fora da caixa)
      if (features.length === 0) {
        const [noBboxNormal, noBboxPOI] = await Promise.all([
          photon(query, null),
          photon(query, null, 'shop|amenity|leisure'),
        ]);
        features = merge(features, merge(noBboxNormal, noBboxPOI));
        features = merge(features, await nominatim(query));
      }

      // 5) Para buscas de bairro/referência: tenta busca ampla sem bbox
      if (features.length === 0 && center) {
        const palavras = query.trim().split(/\s+/);
        if (palavras.length > 1) {
          const ultima = palavras[palavras.length - 1];
          if (ultima.length > 2) {
            const [lastNormal, lastPOI] = await Promise.all([
              photon(ultima, null),
              photon(ultima, null, 'shop|amenity|leisure'),
            ]);
            features = merge(features, merge(lastNormal, lastPOI));
            features = merge(features, await nominatim(ultima));
          }
        }
      }

      const ranked = rankAndSlice(features);
      return ranked.map((f) => ({
        label: formatLabel(f.properties ?? {}),
        lat: f.geometry?.coordinates?.[1] ?? 0,
        lon: f.geometry?.coordinates?.[0] ?? 0,
      }));
    } catch {
      return [];
    }
  }

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    // Tenta Photon primeiro
    try {
      const url = `https://photon.komoot.io/reverse/?lon=${point.lon}&lat=${point.lat}&lang=default`;
      const res = await fetch(url);
      if (res.ok) {
        const data: unknown = await res.json();
        const props = (data as { features?: Array<{ properties?: Record<string, unknown> }> })
          ?.features?.[0]?.properties;
        if (props) {
          const city = props.city || props.city || props.county || props.locality;
          if (typeof city === 'string' && city.length > 0) {
            const result = {
              city,
              state: typeof props.state === 'string' ? props.state : null,
            };
            this.setUserCity(city);
            return result;
          }
        }
      }
    } catch {
      // fallback para Nominatim
    }

    // Fallback: Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${point.lat}&lon=${point.lon}&format=json&addressdetails=1&countrycodes=br`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const a = ((data as { address?: Record<string, string> })?.address ?? {}) as Record<string, string>;
      const city = a.city || a.town || a.village || a.municipality;
      if (city) {
        const result = {
          city,
          state: a.state ?? null,
        };
        this.setUserCity(city);
        return result;
      }
    } catch {
      // sem fallback: retorna null
    }

    return null;
  }
}
