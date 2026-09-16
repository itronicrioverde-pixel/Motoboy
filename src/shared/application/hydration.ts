import type { LoadResult } from './load-result';

// ---------- Tipos ----------

export type FeatureName = 'clientes' | 'moto';

/**
 * Estado de hidratação de uma feature.
 * Discriminated union: combinações inválidas como { status: 'ok', error } são impossíveis.
 */
export type FeatureHydrationState =
  | { readonly status: 'pending' }
  | { readonly status: 'ok' }
  | { readonly status: 'failed'; readonly error: unknown };

export interface FeatureLoaders {
  readonly load: () => Promise<LoadResult<unknown>>;
  readonly hydrate: (data: unknown) => void;
}

// ---------- Fábrica ----------

export interface HydrationManager {
  /** Carrega e hidrata uma feature. Seguro para execução concorrente (void). */
  loadFeature(feature: FeatureName, loaders: FeatureLoaders): Promise<void>;
  /** Retenta uma feature que falhou. Bloqueia retries concorrentes. Retorna Promise que resolve quando completa. */
  retryFeatureLoad(feature: FeatureName, loaders: FeatureLoaders): Promise<void>;
  /** Verifica se a feature está no estado 'failed'. */
  isFeatureFailed(feature: FeatureName): boolean;
  /** Verifica se a feature está hidratada ('ok'). */
  isFeatureHydrated(feature: FeatureName): boolean;
  /** Estado atual (somente leitura). */
  readonly state: Record<FeatureName, FeatureHydrationState>;
}

/**
 * Cria um gerenciador de hidratação independente para as features do painel.
 *
 * Regras:
 * - Cada feature é tratada isoladamente — falha de uma não impede a outra.
 * - 'ok' somente é definido DEPOIS que a função de hidratação termina com sucesso.
 * - Se a função de hidratação não existe ou lança erro → 'failed'.
 * - Retentativas são bloqueadas quando a feature não está 'failed'.
 */
export function createHydrationManager(): HydrationManager {
  const state: Record<FeatureName, FeatureHydrationState> = {
    clientes: { status: 'pending' },
    moto: { status: 'pending' },
  };

  function loadFeature(feature: FeatureName, loaders: FeatureLoaders): Promise<void> {
    return loaders.load().then((result) => {
      applyLoadResult(state, feature, result, loaders);
    }).catch((error) => {
      state[feature] = { status: 'failed', error };
      console.warn(`[Boot] ${feature}: erro inesperado.`, error);
    });
  }

  function retryFeatureLoad(feature: FeatureName, loaders: FeatureLoaders): Promise<void> {
    if (state[feature].status !== 'failed') return Promise.resolve();
    state[feature] = { status: 'pending' };
    return loadFeature(feature, loaders);
  }

  return {
    loadFeature,
    retryFeatureLoad,
    isFeatureFailed: (feature) => state[feature].status === 'failed',
    isFeatureHydrated: (feature) => state[feature].status === 'ok',
    state,
  };
}

/**
 * Aplica o resultado de uma carga (load) ao estado de hidratação.
 * Extraído para permitir teste unitário do fluxo sem dependência de Promise.
 */
export function applyLoadResult(
  state: Record<FeatureName, FeatureHydrationState>,
  feature: FeatureName,
  result: LoadResult<unknown>,
  loaders: FeatureLoaders,
): void {
  if (!result.ok) {
    state[feature] = { status: 'failed', error: result.error };
    console.warn(`[Boot] ${feature}: falha ao carregar; dados locais preservados.`, result.error);
    return;
  }

  // Sucesso no loader: tenta hidratar.
  try {
    loaders.hydrate(result.data);
  } catch (error) {
    state[feature] = { status: 'failed', error };
    console.warn(`[Boot] ${feature}: falha ao hidratar.`, error);
    return;
  }

  // __hydrate* não lançou: marca sucesso.
  state[feature] = { status: 'ok' };
}
