/**
 * Provedor de navegação usando OSRM com steps (instruções passo a passo).
 *
 * Usa o OSRM público (router.project-osrm.org) com:
 * - overview=full → polyline da rota completa
 * - steps=true → instruções de direção
 * - geometries=geojson → formato padrão
 *
 * Gratuito, sem chave de API.
 */

import type { GeoPoint } from '../../mapa/domain/routing';
import type {
  NavigationStep,
  RouteGeometry,
} from '../domain/tracking';

interface OsrmStep {
  geometry?: { coordinates?: number[][] };
  maneuver?: {
    type?: string;
    modifier?: string;
    location?: number[];
  };
  name?: string;
  distance?: number;
  duration?: number;
}

interface OsrmLeg {
  steps?: OsrmStep[];
}

interface OsrmRoute {
  geometry?: { coordinates?: number[][] };
  distance?: number;
  duration?: number;
  legs?: OsrmLeg[];
}

interface OsrmResponse {
  code?: string;
  routes?: OsrmRoute[];
}

/** Mapa de tipo OSRM → texto legível em português. */
const MANEUVER_TEXT: Record<string, (modifier: string | null, name: string) => string> = {
  depart: (_mod, name) => name ? `Siga por ${name}` : 'Siga em frente',
  turn: (mod, name) => {
    const dir = turnDirection(mod);
    return name ? `${dir} em ${name}` : dir;
  },
  new_name: (_mod, name) => name ? `Siga por ${name}` : 'Siga em frente',
  merge: (_mod, name) => name ? `Incorpore a ${name}` : 'Incorpore',
  on_ramp: (_mod, name) => name ? `Pegue a rampa para ${name}` : 'Pegue a rampa',
  off_ramp: (_mod, name) => name ? `Saia na saída para ${name}` : 'Saia na saída',
  fork: (mod, name) => {
    const dir = forkDirection(mod);
    return name ? `Mantenha à ${dir} em ${name}` : `Mantenha à ${dir}`;
  },
  end_of_road: (mod, name) => {
    const dir = turnDirection(mod);
    return name ? `${dir} no final da rua ${name}` : `${dir} no final da rua`;
  },
  continue: (_mod, name) => name ? `Continue por ${name}` : 'Continue em frente',
  roundabout: (_mod, name) => {
    return name ? `Entre na rotatória e saia para ${name}` : 'Entre na rotatória';
  },
  rotary_name: (_mod, name) => name ? `Na rotatória, siga por ${name}` : 'Na rotatória',
  roundabout_turn: (_mod, name) => {
    return name ? `Na rotatória, saia para ${name}` : 'Na rotatória, saia';
  },
  notification: (_mod, name) => name ? `Continue por ${name}` : 'Continue',
  exit_roundabout: (_mod, name) => name ? `Saia da rotatória para ${name}` : 'Saia da rotatória',
};

function turnDirection(modifier: string | null): string {
  switch (modifier) {
    case 'left': return 'Vire à esquerda';
    case 'sharp left': return 'Vire à esquerda';
    case 'slight left': return 'Mantenha à esquerda';
    case 'right': return 'Vire à direita';
    case 'sharp right': return 'Vire à direita';
    case 'slight right': return 'Mantenha à direita';
    case 'uturn': return 'Faça o retorno';
    default: return 'Siga em frente';
  }
}

function forkDirection(modifier: string | null): string {
  switch (modifier) {
    case 'left': case 'slight left': return 'esquerda';
    case 'right': case 'slight right': return 'direita';
    default: return 'frente';
  }
}

/** Converte coordenadas OSRM [lon, lat] → GeoPoint. */
function toGeoPoint(coords: number[]): GeoPoint {
  return { lat: coords[1], lon: coords[0] };
}

export class OsrmNavigationProvider {
  private readonly baseUrl = 'https://router.project-osrm.org/route/v1/driving';
  private readonly timeoutMs: number;

  constructor(timeoutMs = 10000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Busca rota com steps de navegação.
   * @param points Lista de pontos da rota (origem → destinos).
   * @returns Geometry (polyline) + NavigationStep[] ou null.
   */
  async fetchNavigationRoute(
    points: readonly GeoPoint[],
  ): Promise<{ geometry: RouteGeometry; steps: NavigationStep[] } | null> {
    if (points.length < 2) return null;

    const coords = points
      .map((p) => `${p.lon},${p.lat}`)
      .join(';');

    const url = `${this.baseUrl}/${coords}?overview=full&geometries=geojson&steps=true`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;

      const data: OsrmResponse = await res.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;

      const route = data.routes[0];

      // Geometry da rota completa
      const geometry: RouteGeometry = {
        coordinates: (route.geometry?.coordinates ?? []).map(toGeoPoint),
        totalDistanceMeters: route.distance ?? 0,
        totalDurationSeconds: route.duration ?? 0,
      };

      // Steps de todos os legs
      const steps: NavigationStep[] = [];
      for (const leg of route.legs ?? []) {
        for (const step of leg.steps ?? []) {
          const maneuver = step.maneuver;
          if (!maneuver) continue;

          const maneuverType = maneuver.type ?? 'continue';
          const modifier = maneuver.modifier ?? null;
          const name = step.name ?? '';

          const textFn = MANEUVER_TEXT[maneuverType] ?? MANEUVER_TEXT.continue;
          const text = textFn(modifier, name);

          steps.push({
            text,
            maneuverType,
            modifier,
            distanceMeters: step.distance ?? 0,
            durationSeconds: step.duration ?? 0,
            coordinates: maneuver.location ? toGeoPoint(maneuver.location) : { lat: 0, lon: 0 },
          });
        }
      }

      return { geometry, steps };
    } catch {
      return null;
    }
  }
}
