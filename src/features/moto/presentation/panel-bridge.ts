/**
 * Ponte entre o painel legado e a feature Moto.
 *
 * Salva e carrega os dados da moto (km, consumo) do Firestore.
 * Hidratação: retorna dados brutos para main.ts orquestrar a hidratação
 * individual do painel.
 */

import { motoService } from '../index';
import type { MotoData } from '../index';
import type { LoadResult } from '../../../shared/application/load-result';
import { loadOk, loadFail } from '../../../shared/application/load-result';

declare global {
  interface Window {
    __motoboyMoto?: {
      get(): Promise<MotoData>;
      save(data: MotoData): Promise<void>;
    };
    __applyRemoteMoto?: (data: MotoData) => void;
  }
}

export function installMotoBridge(): void {
  window.__motoboyMoto = {
    async get() {
      try {
        return await motoService.get();
      } catch (error) {
        console.error('[Moto] Erro ao ler:', error);
        return { currentKm: 0, consumption: 0, consumptionIsManual: false };
      }
    },
    async save(data) {
      try {
        await motoService.save(data);
      } catch (error) {
        console.error('[Moto] Erro ao salvar:', error);
      }
    },
  };
}

/**
 * Carrega os dados da moto do Firestore e retorna.
 * Nunca lança: retorna ok:false em caso de falha.
 * A hidratação do painel é feita por main.ts via __hydrateMoto.
 */
export async function loadMotoIntoPanel(): Promise<LoadResult<MotoData>> {
  try {
    const data = await motoService.get();
    return loadOk(data);
  } catch (error) {
    console.error('[Moto] Erro ao carregar:', error);
    return loadFail(error);
  }
}
