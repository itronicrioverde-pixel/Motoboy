import { describe, expect, it, vi } from 'vitest';
import type { Rota, RotaService } from '../domain/rota';
import {
  createPendingItemsFromRoute,
  createRouteConfirmationOrchestrator,
  type RouteConfirmationData,
  type RouteConfirmationDependencies,
  type RouteConfirmationDraftService,
} from './route-confirmation-orchestrator';

function draftServices(): RouteConfirmationDraftService[] {
  return [{
    coleta: 'Loja A',
    cliente: 'Cliente A',
    paymentStatus: 'pending',
    entregas: [{
      entrega: 'Rua B',
      valor: 25,
      distancia: 4,
      tempo: 12,
      approx: false,
    }],
  }];
}

function routeData(): RouteConfirmationData {
  return {
    count: 1,
    distancia: 4,
    tempoMin: 12,
    valorTotal: 25,
    custoCombustivel: 2,
    resultado: 23,
    recebidoNaHora: 0,
    pendente: 25,
    data: 'Hoje',
    dateISO: '2026-09-18',
    hora: '15:00',
    createdAt: '2026-09-18T18:00:00.000Z',
    consumoKmL: 35,
    precoLitro: 5.5,
    aproximada: false,
  };
}

function pendingRoute(overrides: Partial<Rota> = {}): Rota {
  const service: RotaService = {
    serviceId: 'svc-fixed',
    coleta: 'Loja A',
    cliente: 'Cliente A',
    paymentStatus: 'pending',
    valorTotal: 25,
    entregas: [{
      endereco: 'Rua B',
      valor: 25,
      distancia: 4,
      tempo: 12,
      aproximada: false,
    }],
  };
  return {
    ...routeData(),
    id: 'rota-fixed',
    services: [service],
    status: 'pending',
    ...overrides,
  };
}

function setup(overrides: Partial<RouteConfirmationDependencies> = {}) {
  const events: string[] = [];
  const dependencies: RouteConfirmationDependencies = {
    generateRouteId: vi.fn(() => {
      events.push('route-id');
      return 'rota-fixed';
    }),
    generateServiceId: vi.fn(() => {
      events.push('service-id');
      return 'svc-fixed';
    }),
    saveRoute: vi.fn(async (route) => {
      events.push(`save-${route.status}`);
    }),
    persistPendingLocally: vi.fn(() => {
      events.push('local-pending');
    }),
    applyFinancialPendings: vi.fn(async () => {
      events.push('financials');
    }),
    completeLocally: vi.fn(() => {
      events.push('complete-local');
    }),
    ...overrides,
  };
  return {
    events,
    dependencies,
    orchestrator: createRouteConfirmationOrchestrator(dependencies),
  };
}

describe('RouteConfirmationOrchestrator', () => {
  it('executa draft → pending → confirmed na ordem obrigatória', async () => {
    const { orchestrator, dependencies, events } = setup();
    const services = draftServices();

    const result = await orchestrator.confirm({
      kind: 'draft',
      services,
      buildRouteData(snapshot) {
        events.push('snapshot');
        expect(snapshot[0].serviceId).toBe('svc-fixed');
        expect(dependencies.generateRouteId).not.toHaveBeenCalled();
        return routeData();
      },
    });

    expect(result.outcome).toBe('confirmed');
    expect(services[0].serviceId).toBe('svc-fixed');
    expect(events).toEqual([
      'service-id',
      'snapshot',
      'route-id',
      'save-pending',
      'local-pending',
      'financials',
      'save-confirmed',
      'complete-local',
    ]);
  });

  it('mantém pending e não executa efeitos de sucesso quando a Fase 2 falha', async () => {
    const error = new Error('finance offline');
    const { orchestrator, dependencies } = setup({
      applyFinancialPendings: vi.fn().mockRejectedValue(error),
    });

    const result = await orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });

    expect(result).toMatchObject({
      outcome: 'pending',
      state: 'pending',
      failedPhase: 'financial-pendings',
    });
    expect(dependencies.saveRoute).toHaveBeenCalledTimes(1);
    expect(dependencies.completeLocally).not.toHaveBeenCalled();
  });

  it('Fase 1 falha sem criar pendências nem efeitos locais', async () => {
    const { orchestrator, dependencies } = setup({
      saveRoute: vi.fn().mockRejectedValue(new Error('route offline')),
    });

    const result = await orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      state: 'draft',
      failedPhase: 'pending-route',
    });
    expect(dependencies.persistPendingLocally).not.toHaveBeenCalled();
    expect(dependencies.applyFinancialPendings).not.toHaveBeenCalled();
    expect(dependencies.completeLocally).not.toHaveBeenCalled();
  });

  it('mantém o snapshot pending quando a Fase 3 falha', async () => {
    const saveRoute = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('confirm offline'));
    const { orchestrator, dependencies } = setup({ saveRoute });

    const result = await orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });

    expect(result).toMatchObject({
      outcome: 'pending',
      state: 'pending',
      failedPhase: 'confirmed-route',
      route: { id: 'rota-fixed', status: 'pending' },
    });
    expect(dependencies.completeLocally).not.toHaveBeenCalled();
  });

  it('retry reutiliza routeId, serviceId e operationId do snapshot persistido', async () => {
    const { orchestrator, dependencies } = setup();
    const route = pendingRoute();

    const result = await orchestrator.confirm({ kind: 'pending', route });

    expect(result.outcome).toBe('confirmed');
    expect(dependencies.generateRouteId).not.toHaveBeenCalled();
    expect(dependencies.generateServiceId).not.toHaveBeenCalled();
    expect(dependencies.applyFinancialPendings).toHaveBeenCalledWith(
      [{
        operationId: 'rota-fixed:svc-fixed',
        nome: 'Cliente A',
        valor: 25,
        desc: 'Rota · 1 entrega(s)',
      }],
      'rota-fixed',
    );
  });

  it('retoma após reload usando exclusivamente a rota pending persistida', async () => {
    const persistedAfterReload = JSON.parse(JSON.stringify(pendingRoute())) as Rota;
    const { orchestrator, dependencies } = setup({
      generateRouteId: vi.fn(() => { throw new Error('não deve gerar routeId'); }),
      generateServiceId: vi.fn(() => { throw new Error('não deve gerar serviceId'); }),
    });

    const result = await orchestrator.confirm({
      kind: 'pending',
      route: persistedAfterReload,
    });

    expect(result).toMatchObject({
      outcome: 'confirmed',
      route: { id: 'rota-fixed', status: 'confirmed' },
    });
    expect(dependencies.generateRouteId).not.toHaveBeenCalled();
    expect(dependencies.generateServiceId).not.toHaveBeenCalled();
    expect(dependencies.applyFinancialPendings).toHaveBeenCalledWith(
      [expect.objectContaining({ operationId: 'rota-fixed:svc-fixed' })],
      'rota-fixed',
    );
  });

  it('retry após falha da Fase 3 não duplica pendências', async () => {
    const persistedRoutes: Rota[] = [];
    const financialLedger = new Set<string>();
    let failFirstConfirmation = true;
    const saveRoute = vi.fn(async (route: Rota) => {
      if (route.status === 'pending') {
        persistedRoutes[0] = JSON.parse(JSON.stringify(route)) as Rota;
        return;
      }
      if (failFirstConfirmation) {
        failFirstConfirmation = false;
        throw new Error('confirm offline');
      }
    });
    const applyFinancialPendings = vi.fn(async (items: readonly { operationId: string }[]) => {
      items.forEach((item) => financialLedger.add(item.operationId));
    });
    const completeLocally = vi.fn();
    const shared = setup({ saveRoute, applyFinancialPendings, completeLocally });

    const first = await shared.orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });
    expect(first).toMatchObject({ outcome: 'pending', failedPhase: 'confirmed-route' });

    // Simula reload: nova instância, sem memória da tentativa anterior.
    const afterReload = createRouteConfirmationOrchestrator(shared.dependencies);
    const retried = await afterReload.confirm({
      kind: 'pending',
      route: persistedRoutes[0],
    });

    expect(retried.outcome).toBe('confirmed');
    expect(applyFinancialPendings).toHaveBeenCalledTimes(2);
    expect(applyFinancialPendings.mock.calls[0][0]).toEqual(
      applyFinancialPendings.mock.calls[1][0],
    );
    expect(financialLedger).toEqual(new Set(['rota-fixed:svc-fixed']));
    expect(completeLocally).toHaveBeenCalledTimes(1);
  });

  it('confirmed é terminal e não reaplica pendências', async () => {
    const { orchestrator, dependencies } = setup();
    const route = pendingRoute({ status: 'confirmed' });

    const result = await orchestrator.confirm({ kind: 'pending', route });

    expect(result).toMatchObject({ outcome: 'terminal', state: 'confirmed' });
    expect(dependencies.saveRoute).not.toHaveBeenCalled();
    expect(dependencies.applyFinancialPendings).not.toHaveBeenCalled();
    expect(dependencies.completeLocally).not.toHaveBeenCalled();
  });

  it('falha local após a Fase 3 não regride o estado terminal', async () => {
    const { orchestrator } = setup({
      completeLocally: vi.fn(() => { throw new Error('DOM indisponível'); }),
    });

    const result = await orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });

    expect(result).toMatchObject({
      outcome: 'confirmed-local-failure',
      state: 'confirmed',
      route: { status: 'confirmed' },
      failedPhase: 'local-completion',
    });
  });

  it('permite somente uma confirmação em andamento e libera o lock no finally', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { orchestrator, dependencies } = setup({
      saveRoute: vi.fn().mockImplementationOnce(() => blocked),
    });

    const first = orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });
    await vi.waitFor(() => expect(orchestrator.isLocked()).toBe(true));

    const concurrent = await orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });
    expect(concurrent.outcome).toBe('busy');
    expect(dependencies.generateRouteId).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(orchestrator.isLocked()).toBe(false);
    expect(dependencies.applyFinancialPendings).toHaveBeenCalledTimes(1);
    expect(dependencies.completeLocally).toHaveBeenCalledTimes(1);
  });

  it('duplo clique em Retomar executa uma única operação', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { orchestrator, dependencies } = setup({
      saveRoute: vi.fn().mockImplementationOnce(() => blocked),
    });
    const route = pendingRoute();

    const first = orchestrator.confirm({ kind: 'pending', route });
    await vi.waitFor(() => expect(orchestrator.isLocked()).toBe(true));
    const second = await orchestrator.confirm({ kind: 'pending', route });

    expect(second.outcome).toBe('busy');
    release();
    await first;
    expect(dependencies.applyFinancialPendings).toHaveBeenCalledTimes(1);
    expect(dependencies.completeLocally).toHaveBeenCalledTimes(1);
  });

  it('confirmação nova e retomada compartilham o mesmo lock', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { orchestrator, dependencies } = setup({
      saveRoute: vi.fn().mockImplementationOnce(() => blocked),
    });

    const newConfirmation = orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });
    await vi.waitFor(() => expect(orchestrator.isLocked()).toBe(true));
    const resume = await orchestrator.confirm({ kind: 'pending', route: pendingRoute() });

    expect(resume.outcome).toBe('busy');
    release();
    await newConfirmation;
    expect(dependencies.applyFinancialPendings).toHaveBeenCalledTimes(1);
    expect(dependencies.completeLocally).toHaveBeenCalledTimes(1);
  });

  it('efeitos de sucesso executam exatamente uma vez', async () => {
    const { orchestrator, dependencies } = setup();
    const first = await orchestrator.confirm({
      kind: 'draft',
      services: draftServices(),
      buildRouteData: routeData,
    });
    expect(first.outcome).toBe('confirmed');
    if (first.outcome !== 'confirmed') throw new Error('confirmação deveria concluir');

    const repeated = await orchestrator.confirm({ kind: 'pending', route: first.route });

    expect(repeated.outcome).toBe('terminal');
    expect(dependencies.applyFinancialPendings).toHaveBeenCalledTimes(1);
    expect(dependencies.completeLocally).toHaveBeenCalledTimes(1);
  });

  it('recusa retry sem serviceId em vez de inventar novos operationIds', async () => {
    const { orchestrator, dependencies } = setup();
    const route = pendingRoute({
      services: [{ ...pendingRoute().services[0], serviceId: undefined }],
    });

    const result = await orchestrator.confirm({ kind: 'pending', route });

    expect(result).toMatchObject({
      outcome: 'pending',
      failedPhase: 'financial-pendings',
    });
    expect(dependencies.generateServiceId).not.toHaveBeenCalled();
    expect(dependencies.completeLocally).not.toHaveBeenCalled();
  });
});

describe('createPendingItemsFromRoute', () => {
  it('ignora recebidos e deriva operationId apenas de routeId + serviceId', () => {
    const route = pendingRoute({
      services: [
        pendingRoute().services[0],
        {
          ...pendingRoute().services[0],
          serviceId: 'svc-received',
          paymentStatus: 'received',
        },
      ],
    });

    expect(createPendingItemsFromRoute(route)).toEqual([{
      operationId: 'rota-fixed:svc-fixed',
      nome: 'Cliente A',
      valor: 25,
      desc: 'Rota · 1 entrega(s)',
    }]);
  });
});
