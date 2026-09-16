import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncGate } from './sync-gate';
import {
  createHydrationManager,
  type FeatureLoaders,
  type HydrationManager,
} from './hydration';
import { loadOk, loadFail } from './load-result';

/**
 * Testes comportamentais de sincronização — porta real.
 *
 * 1. A SyncGate começa fechada.
 * 2. Falha remota mantém a porta fechada.
 * 3. Somente hidratação bem-sucedida abre a porta.
 * 4. Sync acontece somente quando a porta está aberta.
 *
 * Estes testes importam e exercitam a implementação real de SyncGate
 * que é usada pelo panel.js para bloquear/liberar escritas ao Firestore.
 */

function makeSyncLoaders(gate: SyncGate): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadOk([{ nome: 'Teste' }])),
    hydrate: vi.fn(() => { gate.open(); }),
  };
}

function makeFailingLoaders(error: Error): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadFail(error)),
    hydrate: vi.fn(),
  };
}

function makeRejectedLoaders(): FeatureLoaders {
  return {
    load: vi.fn().mockRejectedValue(new Error('Network error')),
    hydrate: vi.fn(),
  };
}

function makeThrowHydrateLoaders(): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadOk([1])),
    hydrate: vi.fn(() => { throw new Error('Ponte indisponível'); }),
  };
}

describe('SyncGate — implementação real', () => {
  it('começa fechada por padrão', () => {
    const gate = new SyncGate();
    expect(gate.isOpen).toBe(false);
    expect(gate.check()).toBe(false);
  });

  it('open() abre a porta', () => {
    const gate = new SyncGate();
    gate.open();
    expect(gate.isOpen).toBe(true);
    expect(gate.check()).toBe(true);
  });

  it('close() fecha a porta', () => {
    const gate = new SyncGate();
    gate.open();
    gate.close();
    expect(gate.isOpen).toBe(false);
  });

  it('construtor com initialState=true começa aberta', () => {
    const gate = new SyncGate(true);
    expect(gate.isOpen).toBe(true);
  });

  it('múltiplas instâncias são independentes', () => {
    const a = new SyncGate();
    const b = new SyncGate();
    a.open();
    expect(a.isOpen).toBe(true);
    expect(b.isOpen).toBe(false);
  });
});

describe('Comportamento de sincronização — gate real + HydrationManager', () => {
  let gate: SyncGate;
  let mgr: HydrationManager;

  beforeEach(() => {
    gate = new SyncGate();
    mgr = createHydrationManager();
  });

  describe('antes da leitura remota', () => {
    it('sync bloqueado antes de loadFeature', () => {
      expect(gate.isOpen).toBe(false);
    });

    it('sync permanece bloqueada enquanto hidratação não completou', async () => {
      expect(gate.isOpen).toBe(false);
      expect(mgr.state.clientes).toEqual({ status: 'pending' });
      expect(gate.isOpen).toBe(false);
    });
  });

  describe('falha remota mantém bloqueio', () => {
    it('loadFail mantém gate fechado', async () => {
      await mgr.loadFeature('clientes', makeFailingLoaders(new Error('timeout')));
      expect(gate.isOpen).toBe(false);
    });

    it('load rejeita mantém gate fechado', async () => {
      await mgr.loadFeature('clientes', makeRejectedLoaders());
      expect(gate.isOpen).toBe(false);
    });

    it('hydrate lança erro mantém gate fechado', async () => {
      await mgr.loadFeature('clientes', makeThrowHydrateLoaders());
      expect(gate.isOpen).toBe(false);
    });
  });

  describe('sucesso libera sincronização', () => {
    it('loadOk + hydrate sem erro abre gate', async () => {
      await mgr.loadFeature('clientes', makeSyncLoaders(gate));
      expect(gate.isOpen).toBe(true);
      expect(mgr.state.clientes).toEqual({ status: 'ok' });
    });
  });

  describe('sync somente quando gate aberto', () => {
    it('0 syncs antes da hidratação, N syncs depois', async () => {
      let syncCount = 0;
      const sync = () => { if (gate.isOpen) syncCount++; };

      for (let i = 0; i < 3; i++) sync();
      expect(syncCount).toBe(0);

      await mgr.loadFeature('clientes', makeSyncLoaders(gate));

      for (let i = 0; i < 3; i++) sync();
      expect(syncCount).toBe(3);
    });

    it('cada mutação gera exatamente 1 sync', async () => {
      let syncCount = 0;
      const sync = () => { if (gate.isOpen) syncCount++; };

      await mgr.loadFeature('clientes', makeSyncLoaders(gate));

      for (let i = 0; i < 5; i++) sync();
      expect(syncCount).toBe(5);
    });
  });

  describe('independência entre features', () => {
    it('falha de clientes não bloqueia sync de moto', async () => {
      const motoGate = new SyncGate();
      const motoLoaders: FeatureLoaders = {
        load: vi.fn().mockResolvedValue(loadOk([{ currentKm: 100 }])),
        hydrate: vi.fn(() => { motoGate.open(); }),
      };

      await Promise.all([
        mgr.loadFeature('clientes', makeFailingLoaders(new Error('timeout'))),
        mgr.loadFeature('moto', motoLoaders),
      ]);

      expect(gate.isOpen).toBe(false);
      expect(motoGate.isOpen).toBe(true);
    });

    it('ambas hidratadas — ambas gates abertas', async () => {
      const motoGate = new SyncGate();
      const motoLoaders: FeatureLoaders = {
        load: vi.fn().mockResolvedValue(loadOk([{ currentKm: 100 }])),
        hydrate: vi.fn(() => { motoGate.open(); }),
      };

      await Promise.all([
        mgr.loadFeature('clientes', makeSyncLoaders(gate)),
        mgr.loadFeature('moto', motoLoaders),
      ]);

      expect(gate.isOpen).toBe(true);
      expect(motoGate.isOpen).toBe(true);
    });
  });

  describe('retry libera gate', () => {
    it('retry com sucesso abre gate', async () => {
      await mgr.loadFeature('clientes', makeFailingLoaders(new Error('timeout')));
      expect(gate.isOpen).toBe(false);

      await mgr.retryFeatureLoad('clientes', makeSyncLoaders(gate));
      expect(gate.isOpen).toBe(true);
    });

    it('retry com falha mantém gate fechado', async () => {
      await mgr.loadFeature('clientes', makeFailingLoaders(new Error('e1')));
      await mgr.retryFeatureLoad('clientes', makeFailingLoaders(new Error('e2')));
      expect(gate.isOpen).toBe(false);
    });
  });
});
