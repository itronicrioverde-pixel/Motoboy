/**
 * Orquestração de hidratação do painel.
 *
 * Extraído de main.ts para permitir teste importável do fluxo real.
 * Utilizado por main.ts (boot) e tests (import direto).
 *
 * Regras DEC-022:
 * - Cada feature tem loader + hydrate independentes.
 * - Gates de sincronização começam fechados.
 * - Somente hidratação bem-sucedida abre os gates.
 * - Sync só ocorre após hidratação + mutação do usuário.
 */

import { SyncGate } from './sync-gate';
import { createHydrationManager, type FeatureLoaders, type HydrationManager } from './hydration';
import type { LoadResult } from './load-result';

// ─── Tipos legados que o painel espera ──────────────────────────────

export type LegacyCliente = {
  readonly id?: string;
  readonly nome: string;
  readonly pendente: number;
  readonly contas: unknown[];
  readonly recebimentos: unknown[];
};

export type MotoData = {
  readonly currentKm: number;
  readonly consumption: number;
  readonly consumptionIsManual: boolean;
};

// ─── Gates compartilhados ───────────────────────────────────────────
// Criados uma única vez e compartilhados entre main.ts e panel.js.
// panel.js importa estes gates e os usa nas suas funções de hidratação.

export const clientsRemoteRead = new SyncGate();
export const clientsHydrated = new SyncGate();
export const motoHydrated = new SyncGate();

// ─── Orquestração ───────────────────────────────────────────────────

export interface PanelHydration {
  readonly hydration: HydrationManager;
  readonly featureLoaders: {
    readonly clientes: FeatureLoaders;
    readonly moto: FeatureLoaders;
  };
  readonly retryFeatureLoad: (feature: 'clientes' | 'moto') => Promise<void>;
}

/**
 * Cria a orquestração de hidratação do painel.
 *
 * Reseta todos os gates no momento da criação.
 * Envelopa cada callback de hidratação: se o callback terminar sem erro,
 * abre os gates correspondentes. Se lançar erro, gates permanecem fechados.
 *
 * `load` é fornecido por cada bridge (loadCustomersIntoPanel, loadMotoIntoPanel).
 * `hydrate` é fornecido por main.ts e delega para window.__hydrate* (panel.js).
 * Panel.js NÃO deve abrir gates — essa responsabilidade é desta orquestração.
 */
export function createPanelHydration(
  clientesLoad: () => Promise<LoadResult<LegacyCliente[]>>,
  motoLoad: () => Promise<LoadResult<MotoData>>,
  clientesHydrate: (data: unknown) => void,
  motoHydrate: (data: unknown) => void,
): PanelHydration {
  // Reseta gates para evitar estado vindo de testes anteriores.
  clientsRemoteRead.close();
  clientsHydrated.close();
  motoHydrated.close();

  const hydration = createHydrationManager();

  const featureLoaders = {
    clientes: {
      load: clientesLoad,
      hydrate: (data: unknown) => {
        clientesHydrate(data);
        clientsRemoteRead.open();
        clientsHydrated.open();
      },
    },
    moto: {
      load: motoLoad,
      hydrate: (data: unknown) => {
        motoHydrate(data);
        motoHydrated.open();
      },
    },
  };

  function retryFeatureLoad(feature: 'clientes' | 'moto'): Promise<void> {
    return hydration.retryFeatureLoad(feature, featureLoaders[feature]);
  }

  return { hydration, featureLoaders, retryFeatureLoad };
}
