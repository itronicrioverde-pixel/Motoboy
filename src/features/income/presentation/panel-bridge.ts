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
      } catch {
        return [];
      }
    },
    async save(entry) {
      try {
        await incomeService.save(entry);
      } catch {
        /* offline/erro */
      }
    },
    async remove(id) {
      try {
        await incomeService.remove(id);
      } catch {
        /* offline/erro */
      }
    },
  };
}

export async function loadIncomeIntoPanel(): Promise<void> {
  try {
    const items = await incomeService.list();
    window.__applyRemoteIncome?.(items);
  } catch {
    /* offline/sem permissão: mantém o cache local */
  }
}
