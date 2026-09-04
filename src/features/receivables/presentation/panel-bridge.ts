/**
 * Ponte entre o painel legado e a feature Receivables (strangler pattern).
 * Expõe window.__motoboyReceivables para o monólito.
 */

import { receivablesService } from '../index';
import type { Receivable } from '../index';

declare global {
  interface Window {
    __motoboyReceivables?: {
      list(): Promise<Receivable[]>;
      listByClient(clientId: string): Promise<Receivable[]>;
      listOpenByClient(clientId: string): Promise<Receivable[]>;
      save(receivable: Receivable): Promise<void>;
      saveBatch(receivables: readonly Receivable[]): Promise<void>;
      remove(id: string): Promise<void>;
    };
    __applyRemoteReceivables?: (entities: Receivable[]) => void;
  }
}

export function installReceivablesBridge(): void {
  window.__motoboyReceivables = {
    async list() {
      try {
        return await receivablesService.list();
      } catch {
        return [];
      }
    },
    async listByClient(clientId) {
      try {
        return await receivablesService.listByClient(clientId);
      } catch {
        return [];
      }
    },
    async listOpenByClient(clientId) {
      try {
        return await receivablesService.listOpenByClient(clientId);
      } catch {
        return [];
      }
    },
    async save(receivable) {
      try {
        await receivablesService.save(receivable);
      } catch {
        /* offline/erro */
      }
    },
    async saveBatch(receivables) {
      try {
        await receivablesService.saveBatch(receivables);
      } catch {
        /* offline/erro */
      }
    },
    async remove(id) {
      try {
        await receivablesService.remove(id);
      } catch {
        /* offline/erro */
      }
    },
  };
}

export async function loadReceivablesIntoPanel(): Promise<void> {
  try {
    const items = await receivablesService.list();
    window.__applyRemoteReceivables?.(items);
  } catch {
    /* offline/sem permissão: mantém o cache local */
  }
}
