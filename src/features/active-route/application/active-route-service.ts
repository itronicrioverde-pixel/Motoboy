/**
 * Caso de uso de Rota Ativa (aplicação).
 *
 * Orquestra: GPS tracking, navegação passo a passo, progresso, otimização.
 * Não conhece DOM nem Firebase — depende de interfaces.
 */

import type {
  ActiveRoute,
  TrackingState,
  RouteProgress,
  Waypoint,
  NavigationStep,
  OptimizationResult,
} from '../domain/tracking';
import { optimizeRoute, haversineKm } from '../domain/route-optimizer';
import type { GpsMonitor } from '../infrastructure/gps-monitor';
import type { OsrmNavigationProvider } from '../infrastructure/osrm-navigation';

/** Velocidade média urbana para estimativas (km/h). */
const AVG_SPEED_KMH = 28;

/** Formata ETA em português. */
function formatETA(seconds: number): string {
  if (seconds < 60) return 'Chegando';
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}min` : `${h}h`;
}

/** Calcula ETA baseado em distância restante. */
function computeETA(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  const hours = km / AVG_SPEED_KMH;
  return formatETA(hours * 3600);
}

export class ActiveRouteService {
  private activeRoute: ActiveRoute | null = null;
  private trackingState: TrackingState | null = null;
  private onStateChange: (() => void) | null = null;

  constructor(
    private readonly gpsMonitor: GpsMonitor,
    private readonly navigationProvider: OsrmNavigationProvider,
  ) {}

  /** Registra callback para mudanças de estado. */
  subscribe(callback: () => void): () => void {
    this.onStateChange = callback;
    return () => { this.onStateChange = null; };
  }

  /** Notifica listeners. */
  private notify(): void {
    this.onStateChange?.();
  }

  /** Retorna a rota ativa atual (ou null). */
  getActiveRoute(): ActiveRoute | null {
    return this.activeRoute;
  }

  /** Retorna o último estado de tracking. */
  getTrackingState(): TrackingState | null {
    return this.trackingState;
  }

  /**
   * Inicia uma nova rota ativa.
   * Busca rota com OSRM e começa GPS tracking.
   */
  async startRoute(waypoints: readonly Waypoint[]): Promise<ActiveRoute | null> {
    if (waypoints.length === 0) return null;

    const routeId = `active-${Date.now()}`;

    // Busca rota com steps
    const coordinates = waypoints.map((w) => w.coordinates);
    const navResult = await this.navigationProvider.fetchNavigationRoute(coordinates);

    const route: ActiveRoute = {
      id: routeId,
      waypoints: waypoints.map((w) => ({ ...w, status: w.status === 'pending' ? 'pending' : w.status })),
      geometry: navResult?.geometry ?? null,
      startedAt: new Date().toISOString(),
      status: 'navigating',
      currentWaypointIndex: 0,
      currentSteps: navResult?.steps ?? [],
      currentStepIndex: 0,
    };

    this.activeRoute = route;

    // Inicia GPS
    this.gpsMonitor.start(
      (state) => {
        this.trackingState = state;
        this.updateProgress();
        this.notify();
      },
    );

    this.notify();
    return route;
  }

  /** Pausa a rota ativa. */
  pauseRoute(): void {
    if (!this.activeRoute) return;
    this.activeRoute = { ...this.activeRoute, status: 'paused' };
    this.gpsMonitor.stop();
    this.notify();
  }

  /** Retoma a rota pausada. */
  resumeRoute(): void {
    if (!this.activeRoute || this.activeRoute.status !== 'paused') return;
    this.activeRoute = { ...this.activeRoute, status: 'navigating' };

    this.gpsMonitor.start(
      (state) => {
        this.trackingState = state;
        this.updateProgress();
        this.notify();
      },
    );

    this.notify();
  }

  /** Para a rota ativa completamente. */
  stopRoute(): void {
    this.gpsMonitor.stop();
    this.activeRoute = null;
    this.trackingState = null;
    this.notify();
  }

  /** Marca o waypoint atual como concluído e avança. */
  completeCurrentStop(): void {
    if (!this.activeRoute) return;

    const idx = this.activeRoute.currentWaypointIndex;
    if (idx >= this.activeRoute.waypoints.length) return;

    const updatedWaypoints = [...this.activeRoute.waypoints];
    updatedWaypoints[idx] = { ...updatedWaypoints[idx], status: 'completed' };

    const nextIndex = idx + 1;
    const isComplete = nextIndex >= updatedWaypoints.length;

    this.activeRoute = {
      ...this.activeRoute,
      waypoints: updatedWaypoints,
      currentWaypointIndex: isComplete ? idx : nextIndex,
      status: isComplete ? 'completed' : 'navigating',
    };

    if (isComplete) {
      this.gpsMonitor.stop();
    }

    this.notify();
  }

  /** Pula o waypoint atual (não entregou). */
  skipCurrentStop(): void {
    if (!this.activeRoute) return;

    const idx = this.activeRoute.currentWaypointIndex;
    if (idx >= this.activeRoute.waypoints.length) return;

    const updatedWaypoints = [...this.activeRoute.waypoints];
    updatedWaypoints[idx] = { ...updatedWaypoints[idx], status: 'skipped' };

    const nextIndex = idx + 1;
    const isComplete = nextIndex >= updatedWaypoints.length;

    this.activeRoute = {
      ...this.activeRoute,
      waypoints: updatedWaypoints,
      currentWaypointIndex: isComplete ? idx : nextIndex,
      status: isComplete ? 'completed' : 'navigating',
    };

    this.notify();
  }

  /** Otimiza a ordem das paradas restantes. */
  optimizeRemaining(): OptimizationResult | null {
    if (!this.activeRoute) return null;

    const remaining = this.activeRoute.waypoints
      .filter((w) => w.status === 'pending');

    if (remaining.length <= 1) return null;

    const result = optimizeRoute(remaining);

    // Reconstrói: completados + otimizados
    const completed = this.activeRoute.waypoints.filter((w) => w.status === 'completed');
    const skipped = this.activeRoute.waypoints.filter((w) => w.status === 'skipped');
    const optimized = [...completed, ...skipped, ...result.optimizedWaypoints];

    this.activeRoute = {
      ...this.activeRoute,
      waypoints: optimized.map((w) => {
        const idx = this.activeRoute!.waypoints.findIndex((aw) => aw.id === w.id);
        return {
          ...w,
          status: idx < this.activeRoute!.currentWaypointIndex ? w.status : 'pending',
        };
      }),
      currentWaypointIndex: completed.length,
    };

    this.notify();
    return result;
  }

  /** Calcula progresso atual da rota. */
  private updateProgress(): void {
    if (!this.activeRoute || !this.trackingState) return;

    const remaining = this.activeRoute.waypoints.filter((w) => w.status === 'pending');

    if (remaining.length === 0) return;

    // Distância restante: posição atual → waypoint atual → próximos
    let distanceRemaining = 0;
    const currentPos = this.trackingState.position;

    if (remaining.length > 0) {
      distanceRemaining += haversineKm(currentPos, remaining[0].coordinates);
      for (let i = 0; i < remaining.length - 1; i++) {
        distanceRemaining += haversineKm(remaining[i].coordinates, remaining[i + 1].coordinates);
      }
    }

    // Distância total estimada (todos os waypoints)
    let totalDistance = 0;
    const allWaypoints = this.activeRoute.waypoints;
    if (allWaypoints.length > 0) {
      totalDistance += haversineKm(currentPos, allWaypoints[0].coordinates);
      for (let i = 0; i < allWaypoints.length - 1; i++) {
        totalDistance += haversineKm(allWaypoints[i].coordinates, allWaypoints[i + 1].coordinates);
      }
    }

    const distanceCompleted = totalDistance - distanceRemaining;
    void distanceCompleted; // used for progress calculation

    // Atualiza steps de navegação baseado na posição atual
    this.updateCurrentStep();

    this.activeRoute = {
      ...this.activeRoute,
    };
  }

  /** Atualiza o step atual de navegação baseado na proximidade. */
  private updateCurrentStep(): void {
    if (!this.activeRoute || !this.trackingState) return;

    const steps = this.activeRoute.currentSteps;
    if (steps.length === 0) return;

    const pos = this.trackingState.position;
    let bestStepIdx = this.activeRoute.currentStepIndex;

    // Encontra o step mais próximo que ainda não foi passado
    for (let i = bestStepIdx; i < steps.length; i++) {
      const dist = haversineKm(pos, steps[i].coordinates);
      if (dist < 0.05) { // 50m — passou do step
        bestStepIdx = Math.min(i + 1, steps.length - 1);
      }
    }

    if (bestStepIdx !== this.activeRoute.currentStepIndex) {
      this.activeRoute = {
        ...this.activeRoute,
        currentStepIndex: bestStepIdx,
      };
    }
  }

  /** Retorna progresso calculado. */
  getProgress(): RouteProgress | null {
    if (!this.activeRoute || !this.trackingState) return null;

    const remaining = this.activeRoute.waypoints.filter((w) => w.status === 'pending');

    let distanceRemaining = 0;
    const pos = this.trackingState.position;

    if (remaining.length > 0) {
      distanceRemaining += haversineKm(pos, remaining[0].coordinates) * 1000;
      for (let i = 0; i < remaining.length - 1; i++) {
        distanceRemaining += haversineKm(remaining[i].coordinates, remaining[i + 1].coordinates) * 1000;
      }
    }

    let totalDistance = 0;
    const all = this.activeRoute.waypoints;
    if (all.length > 0) {
      totalDistance += haversineKm(pos, all[0].coordinates) * 1000;
      for (let i = 0; i < all.length - 1; i++) {
        totalDistance += haversineKm(all[i].coordinates, all[i + 1].coordinates) * 1000;
      }
    }

    const distanceCompleted = totalDistance - distanceRemaining;
    const percentComplete = totalDistance > 0
      ? Math.min(100, Math.round((distanceCompleted / totalDistance) * 100))
      : 0;

    return {
      distanceRemainingMeters: distanceRemaining,
      durationRemainingSeconds: (distanceRemaining / 1000) / AVG_SPEED_KMH * 3600,
      distanceCompletedMeters: distanceCompleted,
      percentComplete,
      currentWaypoint: remaining[0] ?? null,
      nextWaypoint: remaining[1] ?? null,
      ETA: computeETA(distanceRemaining),
    };
  }

  /** Retorna a instrução de navegação atual. */
  getCurrentStep(): NavigationStep | null {
    if (!this.activeRoute) return null;
    return this.activeRoute.currentSteps[this.activeRoute.currentStepIndex] ?? null;
  }
}
