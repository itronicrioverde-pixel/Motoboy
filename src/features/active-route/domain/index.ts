/**
 * API pública do domínio de Rota Ativa.
 * Sem default export; sem helpers internos; sem ciclos.
 */

export type {
  StopType,
  StopStatus,
  Waypoint,
  NavigationStep,
  RouteGeometry,
  ActiveRoute,
  ActiveRouteStatus,
  TrackingState,
  RouteProgress,
  OptimizationResult,
  ShareToken,
} from './tracking';

export {
  optimizeRoute,
  haversineKm,
} from './route-optimizer';
