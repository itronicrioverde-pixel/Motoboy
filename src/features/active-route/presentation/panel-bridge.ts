/**
 * Ponte entre o painel legado e a feature Rota Ativa.
 *
 * Expõe funções globais para o panel.js usar sem dependências diretas.
 * Padrão strangler: o legado chama window.__motoboyActiveRoute.*
 */

import { activeRouteService, sharingService } from '../index';
import type { Waypoint, OptimizationResult, RouteProgress, TrackingState } from '../index';
import { ActiveRoutePanel } from './active-route-panel';

declare global {
  interface Window {
    __motoboyActiveRoute?: {
      start(waypoints: Waypoint[]): Promise<void>;
      pause(): void;
      resume(): void;
      stop(): void;
      completeStop(): void;
      skipStop(): void;
      optimize(): OptimizationResult | null;
      getProgress(): RouteProgress | null;
      getTrackingState(): TrackingState | null;
      getActiveRoute(): ReturnType<typeof activeRouteService.getActiveRoute>;
      subscribe(callback: () => void): () => void;
    };
    __motoboySharing?: {
      start(routeId: string): Promise<string | null>;
      stop(): Promise<void>;
      getState(): ReturnType<typeof sharingService.getState>;
      subscribe(callback: () => void): () => void;
    };
    __ActiveRoutePanel?: typeof ActiveRoutePanel;
  }
}

export function installActiveRouteBridge(): void {
  window.__motoboyActiveRoute = {
    start: async (waypoints) => {
      await activeRouteService.startRoute(waypoints);
    },
    pause: () => activeRouteService.pauseRoute(),
    resume: () => activeRouteService.resumeRoute(),
    stop: () => activeRouteService.stopRoute(),
    completeStop: () => activeRouteService.completeCurrentStop(),
    skipStop: () => activeRouteService.skipCurrentStop(),
    optimize: () => activeRouteService.optimizeRemaining(),
    getProgress: () => activeRouteService.getProgress(),
    getTrackingState: () => activeRouteService.getTrackingState(),
    getActiveRoute: () => activeRouteService.getActiveRoute(),
    subscribe: (callback) => activeRouteService.subscribe(callback),
  };

  window.__motoboySharing = {
    start: (routeId) => sharingService.startSharing(routeId),
    stop: () => sharingService.stopSharing(),
    getState: () => sharingService.getState(),
    subscribe: (callback) => sharingService.subscribe(callback),
  };

  // Expõe a classe do painel para o legado instanciar
  window.__ActiveRoutePanel = ActiveRoutePanel;
}
