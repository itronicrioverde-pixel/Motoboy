/**
 * Otimizador de rotas — Algoritmo Nearest-Neighbor (TSP heurístico).
 *
 * Puro: sem DOM, sem Firebase, sem rede.
 * Recebe paradas com coordenadas e retorna a ordem otimizada.
 *
 * Complexidade: O(n²) — suficiente para 5-20 paradas (cenário motoboy).
 */

import type { GeoPoint } from '../../mapa/domain/routing';
import type { Waypoint, OptimizationResult } from './tracking';

/** Haversine: distância em km entre dois pontos geográficos. */
function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distância entre dois waypoints. */
function distanceBetween(a: Waypoint, b: Waypoint): number {
  return haversineKm(a.coordinates, b.coordinates);
}

/**
 * Calcula a distância total de uma sequência de waypoints.
 */
function totalDistance(waypoints: readonly Waypoint[]): number {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += distanceBetween(waypoints[i], waypoints[i + 1]);
  }
  return total;
}

/**
 * Calcula o tempo total estimado (assumindo velocidade média urbana de 28 km/h).
 */
function estimatedDurationMin(totalKm: number): number {
  return Math.round((totalKm / 28) * 60);
}

/**
 * Nearest-Neighbor TSP: ordena waypoints pela proximidade.
 *
 * 1. Começa pela primeira parada (coleta ou primeira entrega).
 * 2. Encontra a parada não visitada mais próxima.
 * 3. Repete até visitar todas.
 *
 * NOTA: Não é ótimo (óptimo é NP-hard), mas dá ~85-90% da solução
 * ótima para poucos pontos, com O(n²) e zero dependências externas.
 */
export function optimizeRoute(waypoints: readonly Waypoint[]): OptimizationResult {
  if (waypoints.length <= 2) {
    const total = waypoints.length === 2 ? totalDistance(waypoints) : 0;
    return {
      optimizedWaypoints: [...waypoints],
      totalDistanceKm: total,
      totalDurationMin: estimatedDurationMin(total),
      savingsPercent: 0,
    };
  }

  const visited = new Set<number>();
  const optimized: Waypoint[] = [];

  // Começa pelo primeiro waypoint (coleta)
  let currentIndex = 0;
  visited.add(currentIndex);
  optimized.push(waypoints[currentIndex]);

  // Nearest-neighbor: sempre vai para o mais próximo não visitado
  while (visited.size < waypoints.length) {
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    for (let i = 0; i < waypoints.length; i++) {
      if (visited.has(i)) continue;
      const dist = distanceBetween(waypoints[currentIndex], waypoints[i]);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestIndex = i;
      }
    }

    if (nearestIndex === -1) break;
    visited.add(nearestIndex);
    optimized.push(waypoints[nearestIndex]);
    currentIndex = nearestIndex;
  }

  const optimizedDistance = totalDistance(optimized);
  const originalDistance = totalDistance(waypoints);

  // Se a ordem original já é melhor, mantém ela
  if (originalDistance <= optimizedDistance) {
    return {
      optimizedWaypoints: [...waypoints],
      totalDistanceKm: originalDistance,
      totalDurationMin: estimatedDurationMin(originalDistance),
      savingsPercent: 0,
    };
  }

  const savings = originalDistance > 0
    ? ((originalDistance - optimizedDistance) / originalDistance) * 100
    : 0;

  return {
    optimizedWaypoints: optimized,
    totalDistanceKm: optimizedDistance,
    totalDurationMin: estimatedDurationMin(optimizedDistance),
    savingsPercent: Math.round(savings),
  };
}

/**
 * Cálculo de distância entre dois pontos (para uso externo).
 * Reexporta haversineKm de forma controlada.
 */
export { haversineKm };
