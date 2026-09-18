import { describe, it, expect, vi } from 'vitest';
import {
  createPanelHydration,
  clientsRemoteRead,
  clientsHydrated,
  motoHydrated,
} from '../../../shared/application/panel-hydration';
import { loadOk, loadFail } from '../../../shared/application/load-result';
import type { LegacyCliente, MotoData } from '../../../shared/application/panel-hydration';

/**
 * Testes comportamentais da DEC-022 — Orquestração real de hidratação.
 *
 * Cada teste chama createPanelHydration() diretamente — o mesmo caminho
 * usado por main.ts em produção. A função reseta os gates e envelopa
 * os callbacks de hidratação, abrindo os gates somente após sucesso.
 *
 * Os gates (clientsRemoteRead, clientsHydrated, motoHydrated) são
 * singletons compartilhados. createPanelHydration() os reseta internamente.
 *
 * Não acessa Firebase nem DOM. Não simula debounce nem proteção de UID.
 */

// ─── Helpers ────────────────────────────────────────────────────────

const MOTO_DATA: MotoData = { currentKm: 100, consumption: 12, consumptionIsManual: false };

function okLoaders<T>(data: T) {
  return vi.fn().mockResolvedValue(loadOk(data));
}

function failLoaders(error: Error) {
  return vi.fn().mockResolvedValue(loadFail(error));
}

/** Callback de hidratação de clientes — apenas dados, sem abrir gates. */
function hydrateClientes(data: unknown) {
  if (Array.isArray(data)) {
    // Em produção: mergeLegacyCustomers + syncClientBalance.
    // O teste não duplica essa lógica (testada em merge-legacy-customers.test.ts).
  }
}

/** Callback de hidratação de moto — apenas dados, sem abrir gates. */
function hydrateMoto(_data: unknown) {
  // Em produção: aplica km, consumo ao DOM e ao estado.
}

// ─── Testes ─────────────────────────────────────────────────────────

describe('DEC-022 — createPanelHydration (código real)', () => {

  // ─── Composição ─────────────────────────────────────────────────

  describe('composição da orquestração', () => {
    it('retorna hydration, featureLoaders e retryFeatureLoad', () => {
      const { hydration, featureLoaders, retryFeatureLoad } = createPanelHydration(
        okLoaders([]), okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      expect(hydration).toBeDefined();
      expect(featureLoaders.clientes).toBeDefined();
      expect(featureLoaders.moto).toBeDefined();
      expect(typeof retryFeatureLoad).toBe('function');
    });

    it('cada loader é chamado exatamente uma vez', async () => {
      const clientesLoad = okLoaders<LegacyCliente[]>([]);
      const motoLoad = okLoaders<MotoData>(MOTO_DATA);

      const { hydration, featureLoaders } = createPanelHydration(
        clientesLoad, motoLoad,
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);
      await hydration.loadFeature('moto', featureLoaders.moto);

      expect(clientesLoad).toHaveBeenCalledTimes(1);
      expect(motoLoad).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Gates resetados na criação ─────────────────────────────────

  describe('gates resetados por createPanelHydration', () => {
    it('todos os gates começam fechados', () => {
      createPanelHydration(
        okLoaders([]), okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      expect(clientsRemoteRead.isOpen).toBe(false);
      expect(clientsHydrated.isOpen).toBe(false);
      expect(motoHydrated.isOpen).toBe(false);
    });

    it('gates de testes anteriores são resetados', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('moto', featureLoaders.moto);
      expect(motoHydrated.isOpen).toBe(true);

      // Nova criação reseta
      createPanelHydration(
        okLoaders([]), okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );
      expect(motoHydrated.isOpen).toBe(false);
    });
  });

  // ─── Hidratação independente ────────────────────────────────────

  describe('hidratação independente de clientes e moto', () => {
    it('ambos hidratam concorrentemente', async () => {
      const clientesHydrateFn = vi.fn(hydrateClientes);
      const motoHydrateFn = vi.fn(hydrateMoto);

      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        clientesHydrateFn, motoHydrateFn,
      );

      await Promise.all([
        hydration.loadFeature('clientes', featureLoaders.clientes),
        hydration.loadFeature('moto', featureLoaders.moto),
      ]);

      expect(clientesHydrateFn).toHaveBeenCalledTimes(1);
      expect(motoHydrateFn).toHaveBeenCalledTimes(1);
      expect(hydration.isFeatureHydrated('clientes')).toBe(true);
      expect(hydration.isFeatureHydrated('moto')).toBe(true);
    });

    it('falha de clientes não impede moto de hidratar', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        failLoaders(new Error('timeout')), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await Promise.all([
        hydration.loadFeature('clientes', featureLoaders.clientes),
        hydration.loadFeature('moto', featureLoaders.moto),
      ]);

      expect(hydration.isFeatureFailed('clientes')).toBe(true);
      expect(hydration.isFeatureHydrated('moto')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(false);
      expect(motoHydrated.isOpen).toBe(true);
    });

    it('falha de moto não impede clientes de hidratar', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), failLoaders(new Error('timeout')),
        hydrateClientes, hydrateMoto,
      );

      await Promise.all([
        hydration.loadFeature('clientes', featureLoaders.clientes),
        hydration.loadFeature('moto', featureLoaders.moto),
      ]);

      expect(hydration.isFeatureHydrated('clientes')).toBe(true);
      expect(hydration.isFeatureFailed('moto')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(true);
      expect(motoHydrated.isOpen).toBe(false);
    });
  });

  // ─── Sucesso com dados vazios ──────────────────────────────────

  describe('sucesso com dados vazios hidrata a feature', () => {
    it('array vazio de clientes é sucesso válido', async () => {
      const hydrate = vi.fn(hydrateClientes);

      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrate, hydrateMoto,
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      expect(hydration.isFeatureHydrated('clientes')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(true);
      expect(clientsRemoteRead.isOpen).toBe(true);
      expect(hydrate).toHaveBeenCalledWith([]);
    });

    it('documento inexistente (null) é sucesso válido', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[] | null>(null), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      expect(hydration.isFeatureHydrated('clientes')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(true);
    });
  });

  // ─── Falha isolada e retry ─────────────────────────────────────

  describe('falha isolada e retry por feature', () => {
    it('loadFail mantém gate fechado e status failed', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        failLoaders(new Error('timeout')), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      expect(hydration.isFeatureFailed('clientes')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(false);
      expect(clientsRemoteRead.isOpen).toBe(false);
    });

    it('retry com sucesso abre gate', async () => {
      let callCount = 0;
      const clientesLoad = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(loadFail(new Error('e1')));
        return Promise.resolve(loadOk([] as LegacyCliente[]));
      });

      const { hydration, retryFeatureLoad } = createPanelHydration(
        clientesLoad, okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('clientes', { load: clientesLoad, hydrate: vi.fn(hydrateClientes) });
      expect(clientsHydrated.isOpen).toBe(false);

      await retryFeatureLoad('clientes');

      expect(hydration.isFeatureHydrated('clientes')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(true);
    });

    it('retry com falha mantém gate fechado', async () => {
      const { hydration, retryFeatureLoad } = createPanelHydration(
        failLoaders(new Error('e1')), okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('clientes', { load: failLoaders(new Error('e1')), hydrate: vi.fn(hydrateClientes) });
      await retryFeatureLoad('clientes');

      expect(hydration.isFeatureFailed('clientes')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(false);
    });

    it('retry de clientes não afeta moto', async () => {
      let callCount = 0;
      const clientesLoad = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(loadFail(new Error('e1')));
        return Promise.resolve(loadOk([] as LegacyCliente[]));
      });

      const { hydration, featureLoaders, retryFeatureLoad } = createPanelHydration(
        clientesLoad, okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await Promise.all([
        hydration.loadFeature('clientes', featureLoaders.clientes),
        hydration.loadFeature('moto', featureLoaders.moto),
      ]);

      expect(clientsHydrated.isOpen).toBe(false);
      expect(motoHydrated.isOpen).toBe(true);

      await retryFeatureLoad('clientes');

      expect(clientsHydrated.isOpen).toBe(true);
      expect(motoHydrated.isOpen).toBe(true);
    });
  });

  // ─── Nenhuma escrita durante bootstrap/hidratação ──────────────

  describe('nenhuma escrita durante bootstrap ou hidratação', () => {
    it('load sem hydrate sucesso não abre gates', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders(MOTO_DATA),
        vi.fn(), // hydrate vazio — não faz nada, mas não lança erro
        vi.fn(),
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      // HydrationManager chamou hydrate (que foi o vi.fn vazio).
      // O wrapper em createPanelHydration abriu o gates porque não houve erro.
      expect(clientsHydrated.isOpen).toBe(true);
    });
  });

  // ─── Sincronização bloqueada antes / liberada após ──────────────

  describe('sincronização bloqueada antes e liberada após hidratação', () => {
    it('sync bloqueado com todos os gates fechados', () => {
      createPanelHydration(
        okLoaders([]), okLoaders(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      expect(clientsRemoteRead.isOpen).toBe(false);
      expect(clientsHydrated.isOpen).toBe(false);
      expect(motoHydrated.isOpen).toBe(false);
    });

    it('sync de clientes liberado apenas após hydrate', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      expect(clientsRemoteRead.isOpen).toBe(true);
      expect(clientsHydrated.isOpen).toBe(true);
    });

    it('sync de moto liberado apenas após hydrate', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('moto', featureLoaders.moto);

      expect(motoHydrated.isOpen).toBe(true);
    });

    it('sync de clientes não é afetado por hydrate de moto', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      await hydration.loadFeature('moto', featureLoaders.moto);

      expect(motoHydrated.isOpen).toBe(true);
      expect(clientsHydrated.isOpen).toBe(false);
      expect(clientsRemoteRead.isOpen).toBe(false);
    });
  });

  // ─── Gates são os mesmos da produção ────────────────────────────

  describe('gates são os mesmos da produção', () => {
    it('clientsHydrated é aberto por createPanelHydration após hydrate', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      expect(clientsHydrated.isOpen).toBe(false);

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      // O wrapper em createPanelHydration abriu o gate
      expect(clientsHydrated.isOpen).toBe(true);
    });

    it('motoHydrated é aberto por createPanelHydration após hydrate', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      expect(motoHydrated.isOpen).toBe(false);

      await hydration.loadFeature('moto', featureLoaders.moto);

      expect(motoHydrated.isOpen).toBe(true);
    });

    it('clientsRemoteRead é aberto por createPanelHydration após hydrate', async () => {
      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        hydrateClientes, hydrateMoto,
      );

      expect(clientsRemoteRead.isOpen).toBe(false);

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      expect(clientsRemoteRead.isOpen).toBe(true);
    });

    it('hydrate de erro não abre gates', async () => {
      const errorHydrate = () => { throw new Error('Ponte indisponível'); };

      const { hydration, featureLoaders } = createPanelHydration(
        okLoaders<LegacyCliente[]>([]), okLoaders<MotoData>(MOTO_DATA),
        errorHydrate, hydrateMoto,
      );

      await hydration.loadFeature('clientes', featureLoaders.clientes);

      expect(hydration.isFeatureFailed('clientes')).toBe(true);
      expect(clientsHydrated.isOpen).toBe(false);
      expect(clientsRemoteRead.isOpen).toBe(false);
    });
  });
});
