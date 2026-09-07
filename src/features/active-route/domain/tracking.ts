/**
 * Domínio de Rota Ativa (tracking, navegação, progresso).
 *
 * Interfaces puras: sem DOM, sem Firebase, sem GPS.
 * O app depende delas, não das implementações.
 */

import type { GeoPoint } from '../../mapa/domain/routing';

// ---------- Waypoint (parada da rota) ----------

export type StopType = 'pickup' | 'delivery';

export type StopStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface Waypoint {
  readonly id: string;
  readonly type: StopType;
  readonly label: string;
  readonly address: string;
  readonly coordinates: GeoPoint;
  readonly value: number;
  readonly serviceIndex: number;
  readonly entregaIndex: number;
  status: StopStatus;
}

// ---------- NavigationStep (instrução de direção) ----------

export interface NavigationStep {
  readonly text: string;
  readonly maneuverType: string;
  readonly modifier: string | null;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly coordinates: GeoPoint;
}

// ---------- RouteGeometry (polyline da rota) ----------

export interface RouteGeometry {
  readonly coordinates: GeoPoint[];
  readonly totalDistanceMeters: number;
  readonly totalDurationSeconds: number;
}

// ---------- ActiveRoute (estado da rota ativa) ----------

export type ActiveRouteStatus = 'idle' | 'navigating' | 'paused' | 'completed';

export interface ActiveRoute {
  readonly id: string;
  readonly waypoints: readonly Waypoint[];
  readonly geometry: RouteGeometry | null;
  readonly startedAt: string;
  status: ActiveRouteStatus;
  currentWaypointIndex: number;
  readonly currentSteps: readonly NavigationStep[];
  currentStepIndex: number;
}

// ---------- TrackingState (posição em tempo real) ----------

export interface TrackingState {
  readonly position: GeoPoint;
  readonly accuracy: number;
  readonly heading: number | null;
  readonly speed: number | null;
  readonly timestamp: number;
}

// ---------- RouteProgress (progresso calculado) ----------

export interface RouteProgress {
  readonly distanceRemainingMeters: number;
  readonly durationRemainingSeconds: number;
  readonly distanceCompletedMeters: number;
  readonly percentComplete: number;
  readonly currentWaypoint: Waypoint | null;
  readonly nextWaypoint: Waypoint | null;
  readonly ETA: string;
}

// ---------- OptimizationResult ----------

export interface OptimizationResult {
  readonly optimizedWaypoints: readonly Waypoint[];
  readonly totalDistanceKm: number;
  readonly totalDurationMin: number;
  readonly savingsPercent: number;
}

// ---------- ShareToken ----------

export interface ShareToken {
  readonly token: string;
  readonly routeId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
