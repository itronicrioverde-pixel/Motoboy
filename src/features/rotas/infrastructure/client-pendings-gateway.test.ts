import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyRoutePendingsDual: vi.fn(),
}));

vi.mock('../../customers/infrastructure/client-writer', () => ({
  applyRoutePendingsDual: mocks.applyRoutePendingsDual,
}));

import { applyRouteFinancialPendings } from './client-pendings-gateway';

describe('applyRouteFinancialPendings', () => {
  it('passa serviceId para o writer construir o operationId', async () => {
    const expected = [{
      id: 'cliente-1',
      nome: 'Cliente A',
      pendente: 25,
      contas: [],
      recebimentos: [],
    }];
    mocks.applyRoutePendingsDual.mockResolvedValue(expected);
    const items = [{
      serviceId: 'svc-fixed',
      nome: 'Cliente A',
      valor: 25,
      desc: 'Rota · 1 entrega(s)',
    }] as const;

    const result = await applyRouteFinancialPendings(items, 'rota-fixed');

    expect(mocks.applyRoutePendingsDual).toHaveBeenCalledTimes(1);
    expect(mocks.applyRoutePendingsDual).toHaveBeenCalledWith(
      [{
        serviceId: 'svc-fixed',
        nome: 'Cliente A',
        valor: 25,
        desc: 'Rota · 1 entrega(s)',
      }],
      'rota-fixed',
    );
    expect(result).toBe(expected);
  });
});
