import { describe, it, expect, vi } from 'vitest';
import { createHydrationManager } from '../shared/application/hydration';
import { loadOk, loadFail } from '../shared/application/load-result';
import type { FeatureLoaders } from '../shared/application/hydration';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------- Helpers ----------

function makeLoaders(overrides?: Partial<FeatureLoaders>): FeatureLoaders {
  return {
    load: vi.fn().mockResolvedValue(loadOk({ currentKm: 100, consumption: 10, consumptionIsManual: false })),
    hydrate: vi.fn(),
    ...overrides,
  };
}

// ---------- Símbolos removidos ----------

describe('símbolos da fila falsa removidos', () => {
  const panelSrc = fs.readFileSync(
    path.resolve(__dirname, 'panel.js'),
    'utf-8',
  );
  const mainSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'main.ts'),
    'utf-8',
  );

  it('hydrationQueue não existe no painel', () => {
    expect(panelSrc).not.toContain('hydrationQueue');
  });

  it('flushHydrationQueue não existe no painel', () => {
    expect(panelSrc).not.toContain('flushHydrationQueue');
  });

  it('__flushHydrationQueue não existe no main.ts', () => {
    expect(mainSrc).not.toContain('__flushHydrationQueue');
  });

  it('__flushHydrationQueue não existe no painel', () => {
    expect(panelSrc).not.toContain('__flushHydrationQueue');
  });
});

// ---------- Guardas de interação no painel ----------

describe('guardas de interação presentes em todos os handlers de mutação', () => {
  const panelSrc = fs.readFileSync(
    path.resolve(__dirname, 'panel.js'),
    'utf-8',
  );

  it('clienteSave bloqueado por ensureClientesInteractive', () => {
    const match = panelSrc.match(/clienteSave.*?addEventListener\('click',\s*(?:async\s*)?\(\)\s*=>\s*\{([^}]{0,200})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureClientesInteractive');
  });

  it('deleteClient bloqueado por ensureClientesInteractive', () => {
    const match = panelSrc.match(/function\s+deleteClient\s*\([^)]*\)\s*\{([^}]{0,200})/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureClientesInteractive');
  });

  it('recebimentoSave bloqueado por ensureClientesInteractive', () => {
    const match = panelSrc.match(/recebimentoSave.*?addEventListener\('click',\s*(?:async\s*)?\(\)\s*=>\s*\{([^}]{0,200})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureClientesInteractive');
  });

  it('btnConfirmRoute com pendentes bloqueado por ensureClientesInteractive', () => {
    const match = panelSrc.match(/btnConfirmRoute.*?addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{([^}]{0,400})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureClientesInteractive');
  });

  it('cancelamento de rota bloqueado por ensureClientesInteractive', () => {
    const match = panelSrc.match(/\[data-cancel-route\].*?addEventListener\('click',\s*\(\)\s*=>\s*\{([^}]{0,200})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureClientesInteractive');
  });

  it('btnSaveRefuel bloqueado por ensureMotoInteractive', () => {
    const match = panelSrc.match(/btnSaveRefuel.*?addEventListener\('click',\s*\(\)\s*=>\s*\{([^}]{0,200})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureMotoInteractive');
  });

  it('deleteRefuel bloqueado por ensureMotoInteractive', () => {
    const match = panelSrc.match(/function\s+deleteRefuel\s*\([^)]*\)\s*\{([^}]{0,200})/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureMotoInteractive');
  });

  it('maintSave bloqueado por ensureMotoInteractive', () => {
    const match = panelSrc.match(/getElementById\('maintSave'\)\.addEventListener\('click',\s*\(\)\s*=>\s*\{([^}]{0,200})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureMotoInteractive');
  });

  it('deleteMaintenance bloqueado por ensureMotoInteractive', () => {
    const match = panelSrc.match(/function\s+deleteMaintenance\s*\([^)]*\)\s*\{([^}]{0,200})/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureMotoInteractive');
  });

  it('btnSaveConsumption bloqueado por ensureMotoInteractive', () => {
    const match = panelSrc.match(/btnSaveConsumption.*?addEventListener\('click',\s*\(\)\s*=>\s*\{([^}]{0,200})/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('ensureMotoInteractive');
  });
});

// ---------- Retry disparado apenas uma vez ----------

describe('retry disparado somente uma vez em estado failed', () => {
  it('isFeatureFailed retorna true após falha e retryFeatureLoad é chamado uma vez', async () => {
    const mgr = createHydrationManager();
    const failLoaders = makeLoaders({
      load: vi.fn().mockResolvedValue(loadFail(new Error('rede'))),
    });

    await mgr.loadFeature('clientes', failLoaders);
    expect(mgr.isFeatureFailed('clientes')).toBe(true);

    const retryLoad = vi.fn().mockResolvedValue(loadOk([{ nome: 'A' }]));
    const retryHydrate = vi.fn();
    const retryLoaders: FeatureLoaders = { load: retryLoad, hydrate: retryHydrate };

    await mgr.retryFeatureLoad('clientes', retryLoaders);
    expect(retryLoad).toHaveBeenCalledTimes(1);
    expect(retryHydrate).toHaveBeenCalledTimes(1);
    expect(mgr.isFeatureFailed('clientes')).toBe(false);
    expect(mgr.isFeatureHydrated('clientes')).toBe(true);

    await mgr.retryFeatureLoad('clientes', retryLoaders);
    expect(retryLoad).toHaveBeenCalledTimes(1);
  });

  it('retry em pending não dispara load', async () => {
    const mgr = createHydrationManager();
    const loaders = makeLoaders();
    await mgr.retryFeatureLoad('moto', loaders);
    expect(loaders.load).not.toHaveBeenCalled();
  });
});

// ---------- Após hidratação, ação ocorre exatamente uma vez ----------

describe('após hidratação, ação ocorre exatamente uma vez', () => {
  it('loadFeature chama hydrate exatamente uma vez em sucesso', async () => {
    const mgr = createHydrationManager();
    const loaders = makeLoaders();

    await mgr.loadFeature('clientes', loaders);

    expect(loaders.hydrate).toHaveBeenCalledTimes(1);
    expect(mgr.isFeatureHydrated('clientes')).toBe(true);
  });

  it('loadFeature de moto chama hydrate exatamente uma vez', async () => {
    const mgr = createHydrationManager();
    const loaders = makeLoaders();

    await mgr.loadFeature('moto', loaders);

    expect(loaders.hydrate).toHaveBeenCalledTimes(1);
    expect(mgr.isFeatureHydrated('moto')).toBe(true);
  });
});

// ---------- Padrão notifySyncing: retry condicional ----------

describe('padrão notifySyncing: retry condicional por estado', () => {
  function notifySyncingPattern(
    isFeatureFailed: (f: 'clientes' | 'moto') => boolean,
    retryLoadFeature: (f: 'clientes' | 'moto') => void,
    feature: 'clientes' | 'moto',
  ): void {
    if (isFeatureFailed(feature)) {
      retryLoadFeature(feature);
    }
  }

  it('failed dispara retry exatamente uma vez', () => {
    const mgr = createHydrationManager();
    mgr.state.clientes = { status: 'failed', error: new Error('test') };
    const retryFn = vi.fn();

    notifySyncingPattern((f) => mgr.isFeatureFailed(f), retryFn, 'clientes');

    expect(retryFn).toHaveBeenCalledWith('clientes');
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('pending NÃO dispara retry', () => {
    const mgr = createHydrationManager();
    const retryFn = vi.fn();

    notifySyncingPattern((f) => mgr.isFeatureFailed(f), retryFn, 'clientes');

    expect(retryFn).not.toHaveBeenCalled();
  });

  it('ok NÃO dispara retry', () => {
    const mgr = createHydrationManager();
    mgr.state.clientes = { status: 'ok' };
    const retryFn = vi.fn();

    notifySyncingPattern((f) => mgr.isFeatureFailed(f), retryFn, 'clientes');

    expect(retryFn).not.toHaveBeenCalled();
  });

  it('moto failed dispara retry para moto', () => {
    const mgr = createHydrationManager();
    mgr.state.moto = { status: 'failed', error: new Error('km') };
    const retryFn = vi.fn();

    notifySyncingPattern((f) => mgr.isFeatureFailed(f), retryFn, 'moto');

    expect(retryFn).toHaveBeenCalledWith('moto');
  });
});
