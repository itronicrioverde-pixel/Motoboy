/**
 * Ponte entre o painel legado e a feature Moto.
 *
 * Salva e carrega os dados da moto (km, consumo) do Firestore.
 */

import { motoService } from '../index';
import type { MotoData } from '../index';

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

export async function loadMotoIntoPanel(): Promise<void> {
  try {
    const data = await motoService.get();
    window.__applyRemoteMoto?.(data);
  } catch (error) {
    console.error('[Moto] Erro ao carregar:', error);
  }
}
