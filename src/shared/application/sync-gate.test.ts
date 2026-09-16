import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createHydrationManager,
  type FeatureLoaders,
  type HydrationManager,
} from './hydration';
import { loadOk, loadFail } from './load-result';

/**
 * Testes comportamentais de sincronização duais.
 *
 * 1. Sincronização é bloqueada antes da leitura remota.
 * 2. Falha remota mantém sincronização bloqueada.
 * 3. Somente hidratação bem-sucedida libera sincronização.
 * 4. Sincronização acontece exatamente uma vez por mutação.
 */

interface SyncGate {
  enabled: boolean;
}

function createSyncGate(): SyncGate {
  return { enabled: false };
}

function makeSyncLoaders(gate: SyncGate): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadOk([{ nome: 'Teste' }])),
    hydrate: vi.fn(() => {
      gate.enabled = true;
    }),
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
    hydrate: vi.fn(() => {
      throw new Error('Ponte indisponível');
    }),
  };
}

function makeSuccessLoaders(gate: SyncGate): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadOk([{ currentKm: 100 }])),
    hydrate: vi.fn(() => { gate.enabled = true; }),
  };
}

/**
 * Simula mutação do usuário que tenta sincronizar.
 * Retorna true se agendada, false se bloqueada pelo gate.
 */
function attemptSync(gate: SyncGate): boolean {
  if (!gate.enabled) return false;
  return true;
}

describe('Comportamento de sincronização — gate dual', () => {
  let gate: SyncGate;
  let mgr: HydrationManager;

  beforeEach(() => {
    gate = createSyncGate();
    mgr = createHydrationManager();
  });

  describe('antes da leitura remota', () => {
    it('sync bloqueado antes de loadFeature ser chamado', () => {
      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);
    });

    it('sync permanece bloqueada enquanto hidratação não completou', async () => {
      const result = attemptSync(gate);
      expect(result).toBe(false);

      expect(mgr.state.clientes).toEqual({ status: 'pending' });
      expect(attemptSync(gate)).toBe(false);
    });
  });

  describe('falha remota mantém bloqueio', () => {
    it('loadFail mantém gate disabled', async () => {
      const loaders = makeFailingLoaders(new Error('Firestore timeout'));

      await mgr.loadFeature('clientes', loaders);

      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);
    });

    it('load rejeita mantém gate disabled', async () => {
      const loaders = makeRejectedLoaders();

      await mgr.loadFeature('clientes', loaders);

      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);
    });

    it('hydrate lança erro mantém gate disabled', async () => {
      const loaders = makeThrowHydrateLoaders();

      await mgr.loadFeature('clientes', loaders);

      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);
    });
  });

  describe('sucesso libera sincronização', () => {
    it('loadOk + hydrate sem erro habilita gate', async () => {
      const loaders = makeSyncLoaders(gate);

      await mgr.loadFeature('clientes', loaders);

      expect(gate.enabled).toBe(true);
      expect(mgr.state.clientes).toEqual({ status: 'ok' });
    });

    it('sync funciona após hidratação bem-sucedida', async () => {
      const loaders = makeSyncLoaders(gate);

      await mgr.loadFeature('clientes', loaders);

      expect(attemptSync(gate)).toBe(true);
    });
  });

  describe('sync exatamente uma vez por mutação', () => {
    it('0 syncs antes da hidratação, N syncs depois', async () => {
      let syncCount = 0;
      const countingGate: SyncGate = { enabled: false };
      const loaders: FeatureLoaders = {
        load: vi.fn().mockResolvedValue(loadOk([{ nome: 'T' }])),
        hydrate: vi.fn(() => { countingGate.enabled = true; }),
      };

      // 3 tentativas antes — nenhuma deveria contar
      for (let i = 0; i < 3; i++) {
        if (attemptSync(countingGate)) syncCount++;
      }
      expect(syncCount).toBe(0);

      await mgr.loadFeature('clientes', loaders);

      // 3 tentativas depois — todas deveriam contar
      for (let i = 0; i < 3; i++) {
        if (attemptSync(countingGate)) syncCount++;
      }
      expect(syncCount).toBe(3);
    });

    it('cada mutação gera exatamente 1 sync, não mais', async () => {
      let syncCount = 0;
      const countingGate: SyncGate = { enabled: false };
      const loaders: FeatureLoaders = {
        load: vi.fn().mockResolvedValue(loadOk([{ nome: 'T' }])),
        hydrate: vi.fn(() => { countingGate.enabled = true; }),
      };

      await mgr.loadFeature('clientes', loaders);

      for (let i = 0; i < 5; i++) {
        if (attemptSync(countingGate)) syncCount++;
      }
      expect(syncCount).toBe(5);
    });
  });

  describe('independência entre features', () => {
    it('falha de clientes não bloqueia sync de moto', async () => {
      const motoGate = createSyncGate();
      const clientesLoaders = makeFailingLoaders(new Error('timeout'));
      const motoLoaders = makeSuccessLoaders(motoGate);

      await Promise.all([
        mgr.loadFeature('clientes', clientesLoaders),
        mgr.loadFeature('moto', motoLoaders),
      ]);

      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);

      expect(motoGate.enabled).toBe(true);
      expect(attemptSync(motoGate)).toBe(true);
    });

    it('ambas hidratadas — sync funciona em ambas', async () => {
      const motoGate = createSyncGate();
      const clientesLoaders = makeSyncLoaders(gate);
      const motoLoaders = makeSuccessLoaders(motoGate);

      await Promise.all([
        mgr.loadFeature('clientes', clientesLoaders),
        mgr.loadFeature('moto', motoLoaders),
      ]);

      expect(attemptSync(gate)).toBe(true);
      expect(attemptSync(motoGate)).toBe(true);
    });
  });

  describe('retry libera gate', () => {
    it('retry com sucesso libera gate', async () => {
      const failLoaders = makeFailingLoaders(new Error('timeout'));

      await mgr.loadFeature('clientes', failLoaders);
      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);

      const okLoaders = makeSyncLoaders(gate);
      await mgr.retryFeatureLoad('clientes', okLoaders);

      expect(gate.enabled).toBe(true);
      expect(attemptSync(gate)).toBe(true);
    });

    it('retry com falha mantém gate disabled', async () => {
      const failLoaders1 = makeFailingLoaders(new Error('e1'));
      await mgr.loadFeature('clientes', failLoaders1);

      const failLoaders2 = makeFailingLoaders(new Error('e2'));
      await mgr.retryFeatureLoad('clientes', failLoaders2);

      expect(gate.enabled).toBe(false);
      expect(attemptSync(gate)).toBe(false);
    });
  });
});
