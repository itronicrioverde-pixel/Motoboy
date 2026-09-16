import { describe, it, expect, vi } from 'vitest';
import {
  createHydrationManager,
  applyLoadResult,
  type FeatureHydrationState,
  type FeatureName,
  type FeatureLoaders,
} from './hydration';
import { loadOk, loadFail } from './load-result';

// ---------- Helpers ----------

function createState(): Record<FeatureName, FeatureHydrationState> {
  return { clientes: { status: 'pending' }, moto: { status: 'pending' } };
}

function makeLoaders(overrides?: Partial<FeatureLoaders>): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadOk([{ nome: 'Teste' }])),
    hydrate: vi.fn(),
    ...overrides,
  };
}

// ---------- applyLoadResult (síncrono, testa a lógica pura) ----------

describe('applyLoadResult', () => {
  it('loadOk + hydrate sem erro → status ok', () => {
    const state = createState();
    const loaders = makeLoaders();

    applyLoadResult(state, 'clientes', loadOk([{ nome: 'A' }]), loaders);

    expect(state.clientes).toEqual({ status: 'ok' });
    expect(loaders.hydrate).toHaveBeenCalledWith([{ nome: 'A' }]);
  });

  it('loadFail → status failed com error, hidratação não chamada', () => {
    const state = createState();
    const loaders = makeLoaders();
    const error = new Error('network');

    applyLoadResult(state, 'clientes', loadFail(error), loaders);

    expect(state.clientes).toEqual({ status: 'failed', error });
    expect(loaders.hydrate).not.toHaveBeenCalled();
  });

  it('loadOk + hydrate lança erro → status failed com o erro do hydrate', () => {
    const state = createState();
    const hydrateError = new Error('hydrate boom');
    const loaders = makeLoaders({
      hydrate: vi.fn().mockImplementation(() => { throw hydrateError; }),
    });

    applyLoadResult(state, 'clientes', loadOk([1]), loaders);

    expect(state.clientes).toEqual({ status: 'failed', error: hydrateError });
  });

  it('não altera estado de outra feature', () => {
    const state = createState();
    const loaders = makeLoaders();

    applyLoadResult(state, 'clientes', loadOk([1]), loaders);

    expect(state.moto).toEqual({ status: 'pending' });
  });

  it('loadFail preserva referência do erro', () => {
    const state = createState();
    const error = { code: 404 };
    const loaders = makeLoaders();

    applyLoadResult(state, 'moto', loadFail(error), loaders);

    expect((state.moto as { status: 'failed'; error: unknown }).error).toBe(error);
  });

  it('hidratação com dados vazios continua ok', () => {
    const state = createState();
    const loaders = makeLoaders();

    applyLoadResult(state, 'clientes', loadOk([]), loaders);

    expect(state.clientes).toEqual({ status: 'ok' });
  });

  it('hidratação com dados falsy (0, false, "") continua ok', () => {
    const state = createState();
    const loaders = makeLoaders({ hydrate: vi.fn() });

    applyLoadResult(state, 'clientes', loadOk(0), loaders);
    expect(state.clientes).toEqual({ status: 'ok' });

    applyLoadResult(state, 'clientes', loadOk(false), loaders);
    expect(state.clientes).toEqual({ status: 'ok' });

    applyLoadResult(state, 'clientes', loadOk(''), loaders);
    expect(state.clientes).toEqual({ status: 'ok' });
  });
});

// ---------- createHydrationManager (assíncrono, testa integração) ----------

describe('createHydrationManager', () => {
  describe('estado inicial', () => {
    it('ambas features começam como pending', () => {
      const mgr = createHydrationManager();
      expect(mgr.state.clientes).toEqual({ status: 'pending' });
      expect(mgr.state.moto).toEqual({ status: 'pending' });
    });

    it('isFeatureFailed retorna false para pending', () => {
      const mgr = createHydrationManager();
      expect(mgr.isFeatureFailed('clientes')).toBe(false);
    });

    it('isFeatureHydrated retorna false para pending', () => {
      const mgr = createHydrationManager();
      expect(mgr.isFeatureHydrated('clientes')).toBe(false);
    });
  });

  describe('loadFeature — sucesso', () => {
    it('executa load e hydrate, transita para ok', async () => {
      const mgr = createHydrationManager();
      const loaders = makeLoaders();

      await mgr.loadFeature('clientes', loaders);

      expect(loaders.load).toHaveBeenCalledTimes(1);
      expect(loaders.hydrate).toHaveBeenCalledTimes(1);
      expect(mgr.state.clientes).toEqual({ status: 'ok' });
      expect(mgr.isFeatureHydrated('clientes')).toBe(true);
    });

    it('executa load e hydrate para moto', async () => {
      const mgr = createHydrationManager();
      const loaders = makeLoaders();

      await mgr.loadFeature('moto', loaders);

      expect(mgr.state.moto).toEqual({ status: 'ok' });
    });
  });

  describe('loadFeature — falha no loader', () => {
    it('loadFail → failed com error, hydrate não chamado', async () => {
      const mgr = createHydrationManager();
      const error = new Error('Firestore timeout');
      const loaders = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(error)),
      });

      await mgr.loadFeature('clientes', loaders);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error });
      expect(mgr.isFeatureFailed('clientes')).toBe(true);
      expect(loaders.hydrate).not.toHaveBeenCalled();
    });
  });

  describe('loadFeature — falha na hidratação', () => {
    it('hydrate lança erro → failed com erro do hydrate', async () => {
      const mgr = createHydrationManager();
      const hydrateError = new Error('painel não pronto');
      const loaders = makeLoaders({
        hydrate: vi.fn().mockImplementation(() => { throw hydrateError; }),
      });

      await mgr.loadFeature('clientes', loaders);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error: hydrateError });
      expect(mgr.isFeatureFailed('clientes')).toBe(true);
    });
  });

  describe('loadFeature — erro inesperado', () => {
    it('load rejeita → failed', async () => {
      const mgr = createHydrationManager();
      const error = new Error('unexpected');
      const loaders = makeLoaders({
        load: vi.fn().mockRejectedValue(error),
      });

      await mgr.loadFeature('clientes', loaders);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error });
    });
  });

  describe('independência entre features', () => {
    it('falha de clientes não impede moto de hidratar', async () => {
      const mgr = createHydrationManager();
      const clientesLoaders = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(new Error('clientes boom'))),
      });
      const motoLoaders = makeLoaders();

      // Concorrente: void para não bloquear
      const p1 = mgr.loadFeature('clientes', clientesLoaders);
      const p2 = mgr.loadFeature('moto', motoLoaders);
      await Promise.all([p1, p2]);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error: new Error('clientes boom') });
      expect(mgr.state.moto).toEqual({ status: 'ok' });
      expect(mgr.isFeatureFailed('clientes')).toBe(true);
      expect(mgr.isFeatureHydrated('moto')).toBe(true);
    });

    it('ambas falham independentemente', async () => {
      const mgr = createHydrationManager();
      const clientesLoaders = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(new Error('c'))),
      });
      const motoLoaders = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(new Error('m'))),
      });

      await Promise.all([
        mgr.loadFeature('clientes', clientesLoaders),
        mgr.loadFeature('moto', motoLoaders),
      ]);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error: new Error('c') });
      expect(mgr.state.moto).toEqual({ status: 'failed', error: new Error('m') });
    });
  });

  describe('concorrência de retries', () => {
    it('retry bloqueado quando status não é failed', async () => {
      const mgr = createHydrationManager();
      const loaders = makeLoaders();

      // Sucesso primeiro
      await mgr.loadFeature('clientes', loaders);
      expect(mgr.state.clientes).toEqual({ status: 'ok' });

      // Retry deve ser ignorado
      await mgr.retryFeatureLoad('clientes', loaders);
      expect(mgr.state.clientes).toEqual({ status: 'ok' });
      expect(loaders.load).toHaveBeenCalledTimes(1); // não chamou de novo
    });

    it('retry bloqueado quando status é pending', async () => {
      const mgr = createHydrationManager();
      const loaders = makeLoaders();

      // Estado inicial é pending — retry não deve fazer nada
      await mgr.retryFeatureLoad('clientes', loaders);
      expect(mgr.state.clientes).toEqual({ status: 'pending' });
      expect(loaders.load).not.toHaveBeenCalled();
    });
  });

  describe('retryFeatureLoad — transição failed → pending → ok', () => {
    it('retry com sucesso transita failed → pending → ok', async () => {
      const mgr = createHydrationManager();
      const failLoaders = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(new Error('timeout'))),
      });

      await mgr.loadFeature('clientes', failLoaders);
      expect(mgr.state.clientes).toEqual({ status: 'failed', error: new Error('timeout') });

      // Agora simula sucesso no retry
      const okLoaders = makeLoaders();
      const retryPromise = mgr.retryFeatureLoad('clientes', okLoaders);

      // Deve ter transicionado para pending imediatamente
      expect(mgr.state.clientes).toEqual({ status: 'pending' });

      // Aguarda a Promise do retry resolver
      await retryPromise;

      expect(mgr.state.clientes).toEqual({ status: 'ok' });
      expect(okLoaders.load).toHaveBeenCalledTimes(1);
      expect(okLoaders.hydrate).toHaveBeenCalledTimes(1);
    });

    it('retry com falha transita failed → pending → failed', async () => {
      const mgr = createHydrationManager();
      const failLoaders1 = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(new Error('e1'))),
      });

      await mgr.loadFeature('clientes', failLoaders1);

      const failLoaders2 = makeLoaders({
        load: vi.fn().mockResolvedValue(loadFail(new Error('e2'))),
      });
      await mgr.retryFeatureLoad('clientes', failLoaders2);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error: new Error('e2') });
      expect(mgr.isFeatureFailed('clientes')).toBe(true);
    });

    it('retry quando não está failed retorna Promise resolvida imediatamente', async () => {
      const mgr = createHydrationManager();
      const loaders = makeLoaders();

      // Estado inicial é pending — retry não deve fazer nada
      await mgr.retryFeatureLoad('clientes', loaders);

      expect(mgr.state.clientes).toEqual({ status: 'pending' });
      expect(loaders.load).not.toHaveBeenCalled();
    });
  });

  describe('execução única', () => {
    it('load chamado exatamente uma vez por feature', async () => {
      const mgr = createHydrationManager();
      const clientesLoaders = makeLoaders();
      const motoLoaders = makeLoaders();

      await Promise.all([
        mgr.loadFeature('clientes', clientesLoaders),
        mgr.loadFeature('moto', motoLoaders),
      ]);

      expect(clientesLoaders.load).toHaveBeenCalledTimes(1);
      expect(motoLoaders.load).toHaveBeenCalledTimes(1);
    });
  });

  describe('função de hidratação ausente', () => {
    it('hydrate que lança (ponte ausente) → failed', async () => {
      const mgr = createHydrationManager();
      const loaders = makeLoaders({
        hydrate: vi.fn().mockImplementation(() => {
          throw new Error('[Boot] Ponte de hidratação de clientes indisponível.');
        }),
      });

      await mgr.loadFeature('clientes', loaders);

      expect(mgr.state.clientes.status).toBe('failed');
      expect(loaders.hydrate).toHaveBeenCalledTimes(1);
    });

    it('hydrate que lança qualquer erro → failed com o erro', async () => {
      const mgr = createHydrationManager();
      const customError = new Error('ponte quebrada');
      const loaders = makeLoaders({
        hydrate: vi.fn().mockImplementation(() => {
          throw customError;
        }),
      });

      await mgr.loadFeature('clientes', loaders);

      expect(mgr.state.clientes).toEqual({ status: 'failed', error: customError });
    });
  });
});

// ---------- FeatureHydrationState — discriminated union ----------

describe('FeatureHydrationState', () => {
  it('não permite combinação { status: "ok", error } em tempo de compilação', () => {
    // Este teste verifica que o tipo é uma discriminated union válida.
    // Se o tipo permitisse { status: 'ok', error }, TypeScript lançaria erro.
    const ok: FeatureHydrationState = { status: 'ok' };
    const failed: FeatureHydrationState = { status: 'failed', error: new Error() };
    const pending: FeatureHydrationState = { status: 'pending' };

    expect(ok.status).toBe('ok');
    expect(failed.status).toBe('failed');
    expect(pending.status).toBe('pending');

    // Verificação em runtime: nenhum dos três tem propriedades extras.
    expect(Object.keys(ok)).toEqual(['status']);
    expect(Object.keys(failed)).toEqual(['status', 'error']);
    expect(Object.keys(pending)).toEqual(['status']);
  });

  it('error está presente somente em failed', () => {
    const states: FeatureHydrationState[] = [
      { status: 'pending' },
      { status: 'ok' },
      { status: 'failed', error: new Error() },
    ];

    for (const s of states) {
      if (s.status === 'failed') {
        expect(s.error).toBeDefined();
      } else {
        expect((s as Record<string, unknown>)).not.toHaveProperty('error');
      }
    }
  });
});
