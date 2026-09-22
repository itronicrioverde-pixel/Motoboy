import type { Rota, RotaService } from '../domain/rota';

export type RouteConfirmationState = 'draft' | 'pending' | 'confirmed';

export interface RouteConfirmationDraftDelivery {
  readonly entrega: string;
  readonly valor: number | null;
  readonly distancia: number | null;
  readonly tempo: number | null;
  readonly approx?: boolean;
}

export interface RouteConfirmationDraftService {
  serviceId?: string;
  readonly clientId?: string;
  readonly coleta: string;
  readonly cliente: string;
  readonly paymentStatus: string;
  readonly entregas: readonly RouteConfirmationDraftDelivery[];
}

export interface RoutePendingItem {
  readonly serviceId: string;
  readonly clientId?: string;
  readonly nome: string;
  readonly valor: number;
  readonly desc: string;
}

export type RouteConfirmationData = Omit<Rota, 'id' | 'services' | 'status'>;

export interface DraftRouteConfirmationRequest {
  readonly kind: 'draft';
  /**
   * Os objetos são os mesmos usados pela tela. O orquestrador preenche
   * serviceId antes de qualquer await para que uma falha preserve a tentativa.
   */
  readonly services: RouteConfirmationDraftService[];
  readonly buildRouteData: (
    servicesSnapshot: readonly RotaService[],
  ) => RouteConfirmationData | Promise<RouteConfirmationData>;
}

export interface PendingRouteConfirmationRequest {
  readonly kind: 'pending';
  /** Snapshot persistido da tentativa que será retomada. */
  readonly route: Rota;
}

export type RouteConfirmationRequest =
  | DraftRouteConfirmationRequest
  | PendingRouteConfirmationRequest;

export interface RouteConfirmationDependencies {
  readonly generateRouteId: () => string;
  readonly generateServiceId: () => string;
  readonly saveRoute: (route: Rota) => Promise<void>;
  readonly persistPendingLocally: (route: Rota) => void;
  readonly applyFinancialPendings: (
    items: readonly RoutePendingItem[],
    routeId: string,
  ) => Promise<void>;
  /** Efeitos locais de sucesso. Só é chamado depois da Fase 3. */
  readonly completeLocally: (route: Rota) => void;
}

export type RouteConfirmationFailurePhase =
  | 'preparation'
  | 'pending-route'
  | 'local-pending'
  | 'financial-pendings'
  | 'confirmed-route'
  | 'local-completion';

export type RouteConfirmationResult =
  | { readonly outcome: 'confirmed'; readonly state: 'confirmed'; readonly route: Rota }
  | {
      readonly outcome: 'confirmed-local-failure';
      readonly state: 'confirmed';
      readonly route: Rota;
      readonly failedPhase: 'local-completion';
      readonly error: unknown;
    }
  | {
      readonly outcome: 'pending';
      readonly state: 'pending';
      readonly route: Rota;
      readonly failedPhase: RouteConfirmationFailurePhase;
      readonly error: unknown;
    }
  | {
      readonly outcome: 'failed';
      readonly state: 'draft';
      readonly failedPhase: RouteConfirmationFailurePhase;
      readonly error: unknown;
    }
  | { readonly outcome: 'busy'; readonly state: RouteConfirmationState }
  | { readonly outcome: 'terminal'; readonly state: 'confirmed'; readonly route: Rota };

export interface RouteConfirmationOrchestrator {
  confirm(request: RouteConfirmationRequest): Promise<RouteConfirmationResult>;
  isLocked(): boolean;
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} não pode ser vazio.`);
  return normalized;
}

function ensurePermanentServiceIds(
  services: RouteConfirmationDraftService[],
  generateServiceId: () => string,
): void {
  const seen = new Set<string>();

  for (const service of services) {
    if (!service.serviceId) {
      service.serviceId = requiredId(generateServiceId(), 'serviceId');
    }
    const serviceId = requiredId(service.serviceId, 'serviceId');
    if (seen.has(serviceId)) {
      throw new Error(`serviceId duplicado na tentativa: ${serviceId}.`);
    }
    service.serviceId = serviceId;
    seen.add(serviceId);
  }
}

export function createServicesSnapshot(
  services: readonly RouteConfirmationDraftService[],
): RotaService[] {
  return services.map((service) => ({
    serviceId: requiredId(service.serviceId ?? '', 'serviceId'),
    ...(service.clientId ? { clientId: service.clientId } : {}),
    coleta: service.coleta,
    cliente: service.cliente,
    paymentStatus: service.paymentStatus,
    valorTotal: Math.round(
      (service.entregas.reduce((sum, entrega) => sum + (entrega.valor ?? 0), 0)
        + Number.EPSILON) * 100,
    ) / 100,
    entregas: service.entregas.map((entrega) => ({
      endereco: entrega.entrega,
      valor: entrega.valor ?? 0,
      distancia: entrega.distancia,
      tempo: entrega.tempo,
      aproximada: Boolean(entrega.approx),
    })),
  }));
}

function clonePendingRoute(route: Rota): Rota {
  return {
    ...route,
    status: 'pending',
    services: route.services.map((service) => ({
      ...service,
      entregas: service.entregas.map((entrega) => ({ ...entrega })),
    })),
  };
}

/** Reconstrói as pendências exclusivamente do snapshot persistido da rota. */
export function createPendingItemsFromRoute(route: Rota): RoutePendingItem[] {
  const seen = new Set<string>();

  return route.services.flatMap((service) => {
    if (service.paymentStatus === 'received') return [];

    const serviceId = requiredId(service.serviceId ?? '', 'serviceId da rota pendente');
    if (seen.has(serviceId)) {
      throw new Error(`serviceId duplicado na rota pendente: ${serviceId}.`);
    }
    seen.add(serviceId);

    return [{
      serviceId,
      ...(service.clientId ? { clientId: service.clientId } : {}),
      nome: service.cliente.trim(),
      valor: service.valorTotal,
      desc: `Rota · ${service.entregas.length} entrega(s)`,
    }];
  });
}

export function createRouteConfirmationOrchestrator(
  dependencies: RouteConfirmationDependencies,
): RouteConfirmationOrchestrator {
  let locked = false;
  let state: RouteConfirmationState = 'draft';

  async function confirm(
    request: RouteConfirmationRequest,
  ): Promise<RouteConfirmationResult> {
    if (locked) return { outcome: 'busy', state };

    locked = true;
    let pendingRoute: Rota | null = null;
    let resuming = false;

    try {
      if (request.kind === 'pending') {
        if (request.route.status === 'confirmed') {
          state = 'confirmed';
          return { outcome: 'terminal', state, route: request.route };
        }
        resuming = true;
        pendingRoute = clonePendingRoute(request.route);
      } else {
        state = 'draft';
        try {
          // Ordem obrigatória: IDs permanentes → snapshot → routeId.
          ensurePermanentServiceIds(request.services, dependencies.generateServiceId);
          const servicesSnapshot = createServicesSnapshot(request.services);
          const routeData = await request.buildRouteData(servicesSnapshot);
          const routeId = requiredId(dependencies.generateRouteId(), 'routeId');
          pendingRoute = {
            ...routeData,
            id: routeId,
            services: servicesSnapshot,
            status: 'pending',
          };
        } catch (error) {
          return {
            outcome: 'failed',
            state: 'draft',
            failedPhase: 'preparation',
            error,
          };
        }
      }

      state = 'pending';

      try {
        await dependencies.saveRoute(pendingRoute);
      } catch (error) {
        if (resuming) {
          return {
            outcome: 'pending',
            state,
            route: pendingRoute,
            failedPhase: 'pending-route',
            error,
          };
        }
        return {
          outcome: 'failed',
          state: 'draft',
          failedPhase: 'pending-route',
          error,
        };
      }

      try {
        dependencies.persistPendingLocally(pendingRoute);
      } catch (error) {
        return {
          outcome: 'pending',
          state,
          route: pendingRoute,
          failedPhase: 'local-pending',
          error,
        };
      }

      let pendingItems: RoutePendingItem[];
      try {
        pendingItems = createPendingItemsFromRoute(pendingRoute);
        if (pendingItems.length > 0) {
          await dependencies.applyFinancialPendings(pendingItems, pendingRoute.id);
        }
      } catch (error) {
        return {
          outcome: 'pending',
          state,
          route: pendingRoute,
          failedPhase: 'financial-pendings',
          error,
        };
      }

      const confirmedRoute: Rota = { ...pendingRoute, status: 'confirmed' };
      try {
        await dependencies.saveRoute(confirmedRoute);
      } catch (error) {
        return {
          outcome: 'pending',
          state,
          route: pendingRoute,
          failedPhase: 'confirmed-route',
          error,
        };
      }

      state = 'confirmed';
      try {
        dependencies.completeLocally(confirmedRoute);
      } catch (error) {
        return {
          outcome: 'confirmed-local-failure',
          state: 'confirmed',
          route: confirmedRoute,
          failedPhase: 'local-completion',
          error,
        };
      }

      return { outcome: 'confirmed', state, route: confirmedRoute };
    } finally {
      locked = false;
    }
  }

  return {
    confirm,
    isLocked: () => locked,
  };
}
