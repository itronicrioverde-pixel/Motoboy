/**
 * Composition root da feature Rota Ativa.
 *
 * Conecta: GPS monitor → OSRM navigation → ActiveRouteService
 *          Firestore sharing → SharingService
 */

import { GpsMonitor } from './infrastructure/gps-monitor';
import { OsrmNavigationProvider } from './infrastructure/osrm-navigation';
import { FirestoreSharingRepository } from './infrastructure/firestore-sharing';
import { ActiveRouteService } from './application/active-route-service';
import { SharingService } from './application/sharing-service';
import { currentUid } from '../auth/application/auth-service';

// ---------- Infraestrutura ----------

/** Monitor de GPS (singleton reutilizável). */
export const gpsMonitor = new GpsMonitor({ targetAccuracy: 30, minInterval: 3000 });

/** Provedor de navegação OSRM. */
export const navigationProvider = new OsrmNavigationProvider();

/** Repositório de compartilhamento Firestore. */
const sharingRepository = new FirestoreSharingRepository(() => currentUid());

// ---------- Serviços ----------

/** Serviço de rota ativa. */
export const activeRouteService = new ActiveRouteService(gpsMonitor, navigationProvider);

/** Serviço de compartilhamento. */
export const sharingService = new SharingService(
  sharingRepository,
  () => new GpsMonitor({ targetAccuracy: 50, minInterval: 5000 }),
  () => window.location.origin,
);

// ---------- Tipos ----------

export type {
  ActiveRoute,
  ActiveRouteStatus,
  Waypoint,
  NavigationStep,
  TrackingState,
  RouteProgress,
  OptimizationResult,
  ShareToken,
  StopStatus,
  StopType,
} from './domain/tracking';

export { optimizeRoute } from './domain/route-optimizer';
export type { SharingState } from './application/sharing-service';
