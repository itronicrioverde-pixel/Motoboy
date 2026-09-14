/**
 * Ponte entre o painel legado e a feature Income (strangler pattern).
 * Expõe window.__motoboyIncome para o monólito.
 */

import { incomeService } from '../index';
import type { IncomeEntry } from '../index';

declare global {
  interface Window {
    __motoboyIncome?: {
      list(): Promise<IncomeEntry[]>;
      save(entry: IncomeEntry): Promise<void>;
      remove(id: string): Promise<void>;
    };
    __applyRemoteIncome?: (entities: IncomeEntry[]) => void;
  }
}

export function installIncomeBridge(): void {
  window.__motoboyIncome = {
    async list() {
      try {
        return await incomeService.list();
      } catch (error) {
        console.error('[Entradas] Erro ao listar:', error);
        return [];
      }
    },
    async save(entry) {
      try {
        await incomeService.save(entry);
      } catch (error) {
        console.error('[Entradas] Erro ao salvar:', error);
        /* offline/erro */
      }
    },
    async remove(id) {
      try {
        await incomeService.remove(id);
      } catch (error) {
        console.error('[Entradas] Erro ao remover:', error);
        /* offline/erro */
      }
    },
  };
}

export async function loadIncomeIntoPanel(): Promise<void> {
  try {
    const items = await incomeService.list();
    window.__applyRemoteIncome?.(items);
  } catch (error) {
    console.error('[Entradas] Erro ao carregar:', error);
    /* offline/sem permissão: mantém o cache local */
  }
}
