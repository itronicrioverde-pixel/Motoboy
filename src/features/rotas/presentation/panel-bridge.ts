/**
 * Ponte entre o painel legado e a feature Rotas (strangler pattern).
 * O objeto de rota do monólito já tem o formato da entidade (mesmos campos +
 * id estável), então o write-through é quase pass-through.
 */

import { rotasService } from '../index';
import type { Rota } from '../index';
import type { LoadResult } from '../../../shared/application/load-result';
import { loadOk, loadFail } from '../../../shared/application/load-result';
import { cancelRouteDual } from '../../customers/infrastructure/client-writer';
import type { LegacyCliente } from '../../customers/application/merge-legacy-customers';

declare global {
  interface Window {
    __motoboyRotas?: {
      save(rota: Rota): Promise<void>;
      remove(id: string): Promise<void>;
      cancelAtomic(routeId: string): Promise<LegacyCliente[]>;
    };
    __applyRemoteRotas?: (entities: Rota[]) => void;
  }
}

export function installRotasBridge(): void {
  window.__motoboyRotas = {
    async save(rota) {
      await rotasService.save(rota);
    },
    async remove(id) {
      await rotasService.remove(id);
    },
    async cancelAtomic(routeId) {
      return cancelRouteDual(routeId);
    },
  };
}

/**
 * Carrega as rotas do dono no Firestore e injeta no painel.
 * Nunca lança: retorna ok:false em caso de falha.
 */
export async function loadRotasIntoPanel(): Promise<LoadResult<Rota[]>> {
  try {
    const items = await rotasService.list();
    window.__applyRemoteRotas?.(items);
    return loadOk(items);
  } catch (error) {
    console.error('[Rotas] Erro ao carregar:', error);
    return loadFail(error);
  }
}
