/**
 * Ponte entre o painel legado e a feature Rotas (strangler pattern).
 * O objeto de rota do monólito já tem o formato da entidade (mesmos campos +
 * id estável), então o write-through é quase pass-through.
 */

import { rotasService } from '../index';
import type { Rota } from '../index';
import type { LoadResult } from '../../abastecimentos/presentation/panel-bridge';

declare global {
  interface Window {
    __motoboyRotas?: {
      save(rota: Rota): Promise<void>;
      remove(id: string): Promise<void>;
    };
    __applyRemoteRotas?: (entities: Rota[]) => void;
  }
}

export function installRotasBridge(): void {
  window.__motoboyRotas = {
    async save(rota) {
      try {
        await rotasService.save(rota);
      } catch (error) {
        console.error('[Rotas] Erro ao salvar:', error);
        /* offline/erro: mantém o cache local */
      }
    },
    async remove(id) {
      try {
        await rotasService.remove(id);
      } catch (error) {
        console.error('[Rotas] Erro ao remover:', error);
        /* offline/erro: mantém o cache local */
      }
    },
  };
}

/**
 * Carrega as rotas do dono no Firestore e injeta no painel.
 * Retorna sucesso, vazio ou falha explicitamente.
 * Erro capturado NÃO é considerado carregamento concluído.
 */
export async function loadRotasIntoPanel(): Promise<LoadResult<Rota[]>> {
  const items = await rotasService.list();
  window.__applyRemoteRotas?.(items);
  return { ok: true, data: items };
}
