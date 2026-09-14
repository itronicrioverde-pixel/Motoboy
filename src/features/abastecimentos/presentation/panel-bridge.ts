/**
 * Ponte entre o painel legado e a feature Abastecimentos (strangler pattern).
 * Traduz o "view-model" do monólito (refuels) para a entidade do domínio e vice-versa,
 * e faz o write-through para o Firestore. O monólito continua dono da UI; aqui só
 * cuidamos da persistência.
 */

import { abastecimentosService } from '../index';
import type { Abastecimento, EditAbastecimento, NewAbastecimento } from '../index';

/** Resultado explícito do carregamento remoto. */
export interface LoadResult<T> {
  ok: boolean;
  data: T;
}

/** Formato do registro como o monólito o mantém em `refuels`. */
interface RefuelVM {
  fsId?: string | null;
  local: string;
  valor: number;
  pricePerLiter: number;
  odometer: number | null;
  dateISO: string;
  editReason?: string | null;
}

function vmToNew(vm: RefuelVM): NewAbastecimento {
  return {
    dateISO: vm.dateISO,
    location: vm.local,
    paidValue: vm.valor,
    pricePerLiter: vm.pricePerLiter,
    odometer: vm.odometer ?? null,
  };
}

function vmToEdit(vm: RefuelVM): EditAbastecimento {
  return { ...vmToNew(vm), editReason: vm.editReason ?? null };
}

declare global {
  interface Window {
    /** Chamado pelo monólito ao criar/editar/excluir um abastecimento. */
    __motoboyAbastecimentos?: {
      add(vm: RefuelVM): Promise<string | null>;
      update(fsId: string | null | undefined, vm: RefuelVM): Promise<void>;
      remove(fsId: string | null | undefined): Promise<void>;
    };
    /** Definido pelo monólito; recebe as entidades do Firestore e re-renderiza. */
    __applyRemoteAbastecimentos?: (entities: Abastecimento[]) => void;
  }
}

/** Instala o write-through para o monólito usar (deve rodar cedo, no boot). */
export function installAbastecimentosBridge(): void {
  window.__motoboyAbastecimentos = {
    async add(vm) {
      try {
        const created = await abastecimentosService.add(vmToNew(vm));
        return created.id;
      } catch (error) {
        console.error('[Abastecimentos] Erro ao adicionar:', error);
        return null; // offline/erro: fica só no cache local
      }
    },
    async update(fsId, vm) {
      if (!fsId) return;
      try {
        await abastecimentosService.update(fsId, vmToEdit(vm));
      } catch (error) {
        console.error('[Abastecimentos] Erro ao atualizar:', error);
        /* offline/erro: mantém o cache local */
      }
    },
    async remove(fsId) {
      if (!fsId) return;
      try {
        await abastecimentosService.remove(fsId);
      } catch (error) {
        console.error('[Abastecimentos] Erro ao remover:', error);
        /* offline/erro: mantém o cache local */
      }
    },
  };
}

/**
 * Carrega os abastecimentos do dono no Firestore e injeta no painel.
 * Retorna sucesso, vazio ou falha explicitamente.
 * Erro capturado NÃO é considerado carregamento concluído.
 */
export async function loadAbastecimentosIntoPanel(): Promise<LoadResult<Abastecimento[]>> {
  const items = await abastecimentosService.list();
  window.__applyRemoteAbastecimentos?.(items);
  return { ok: true, data: items };
}
