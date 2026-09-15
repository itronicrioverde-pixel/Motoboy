/**
 * Ponte entre o painel legado e a feature Faturamento (entradas manuais).
 * Write-through para o Firestore; a mesclagem com as entradas locais (de rota
 * e offline) é feita no hook do monólito, que conhece o array `entradas`.
 */

import { entradasService } from '../index';
import type { EditEntrada, Entrada, NewEntrada } from '../index';
import type { LoadResult } from '../../../shared/application/load-result';
import { loadOk, loadFail } from '../../../shared/application/load-result';

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
      add(vm: EntradaVM): Promise<string | null>;
      update(fsId: string | null | undefined, vm: EntradaVM): Promise<void>;
      remove(fsId: string | null | undefined): Promise<void>;
    };
    __applyRemoteEntradas?: (entities: Entrada[]) => void;
  }
}

export function installFaturamentoBridge(): void {
  window.__motoboyEntradas = {
    async add(vm) {
      try {
        const created = await entradasService.add(vmToNew(vm));
        return created.id;
      } catch (error) {
        console.error('[Faturamento] Erro ao adicionar:', error);
        return null;
      }
    },
    async update(fsId, vm) {
      if (!fsId) return;
      try {
        await entradasService.update(fsId, vmToEdit(vm));
      } catch (error) {
        console.error('[Faturamento] Erro ao atualizar:', error);
        /* offline/erro: mantém o cache local */
      }
    },
    async remove(fsId) {
      if (!fsId) return;
      try {
        await entradasService.remove(fsId);
      } catch (error) {
        console.error('[Faturamento] Erro ao remover:', error);
        /* offline/erro: mantém o cache local */
      }
    },
  };
}

/**
 * Carrega as entradas do dono no Firestore e injeta no painel.
 * Nunca lança: retorna ok:false em caso de falha.
 */
export async function loadFaturamentoIntoPanel(): Promise<LoadResult<Entrada[]>> {
  try {
    const items = await entradasService.list();
    window.__applyRemoteEntradas?.(items);
    return loadOk(items);
  } catch (error) {
    console.error('[Faturamento] Erro ao carregar:', error);
    return loadFail(error);
  }
}
