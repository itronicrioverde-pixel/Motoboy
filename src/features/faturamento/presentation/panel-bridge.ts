/**
 * Ponte entre o painel legado e a feature Faturamento (entradas manuais).
 * Write-through para o Firestore; a mesclagem com as entradas locais (de rota
 * e offline) é feita no hook do monólito, que conhece o array `entradas`.
 */

import { entradasService } from '../index';
import type { EditEntrada, NewEntrada } from '../index';
import { entradaToEntryVM } from './entrada-view-model';
import type { EntradaEntryVM } from './entrada-view-model';
import type { LoadResult } from '../../../shared/application/load-result';
import { loadOk, loadFail } from '../../../shared/application/load-result';
import { durableCreateManager } from '../../../shared/infrastructure/durable-create-runtime';
import type { DurableCreateAttempt, DurableCreateResult } from '../../../shared/application/durable-create-manager';

interface EntradaVM {
  fsId?: string | null;
  desc: string;
  valor: number;
  dateISO: string;
  editReason?: string | null;
}

function vmToNew(vm: EntradaVM): NewEntrada {
  return { desc: vm.desc, valor: vm.valor, dateISO: vm.dateISO };
}

function vmToEdit(vm: EntradaVM): EditEntrada {
  return { ...vmToNew(vm), editReason: vm.editReason ?? null };
}

declare global {
  interface Window {
    __motoboyEntradas?: {
      prepare(vm: EntradaVM): DurableCreateAttempt;
      pending(): DurableCreateAttempt[];
      retry(id: string): Promise<DurableCreateResult>;
      update(fsId: string | null | undefined, vm: EntradaVM): Promise<void>;
      remove(fsId: string | null | undefined): Promise<void>;
    };
    __applyRemoteEntradas?: (entries: EntradaEntryVM[]) => void;
  }
}

export function installFaturamentoBridge(): void {
  window.__motoboyEntradas = {
    prepare(vm) {
      const data = vmToNew(vm);
      return durableCreateManager.prepare('entradas', (id, createdAt) => ({
        createAttemptId: id, createdAt, updatedAt: createdAt, edited: false, editReason: null,
        desc: data.desc, valor: data.valor, dateISO: data.dateISO,
      }));
    },
    pending: () => durableCreateManager.pending('entradas'),
    retry: (id) => durableCreateManager.retry('entradas', id),
    async update(fsId, vm) {
      if (!fsId) return;
      await entradasService.update(fsId, vmToEdit(vm));
    },
    async remove(fsId) {
      if (!fsId) return;
      await entradasService.remove(fsId);
    },
  };
}

/**
 * Carrega as entradas do dono no Firestore e injeta no painel como view models já
 * mapeados (fsId + identidade de recebimento preservada).
 * Nunca lança: retorna ok:false em caso de falha.
 */
export async function loadFaturamentoIntoPanel(): Promise<LoadResult<EntradaEntryVM[]>> {
  try {
    const items = await entradasService.list();
    window.__applyRemoteEntradas?.(items.map(entradaToEntryVM));
    return loadOk(items.map(entradaToEntryVM));
  } catch (error) {
    console.error('[Faturamento] Erro ao carregar:', error);
    return loadFail(error);
  }
}
