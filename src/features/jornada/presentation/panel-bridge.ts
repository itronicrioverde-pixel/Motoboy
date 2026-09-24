/**
 * Ponte entre o painel legado e a feature Jornada (strangler pattern).
 *
 * O monólito segue dono da UI; aqui traduzimos o registro local para a entidade
 * do domínio, abrimos/fechamos a jornada no Firestore e injetamos a carga
 * remota no painel.
 */

import { jornadaService } from '../index';
import type { CloseJornada, Jornada, NewJornada } from '../index';
import type { LoadResult } from '../../../shared/application/load-result';
import { loadOk, loadFail } from '../../../shared/application/load-result';

/** Formato do registro como o monólito o mantém em `jornadas`. */
export interface JornadaVM {
  fsId?: string | null;
  status: 'open' | 'closed';
  kmInicial: number;
  dataInicioISO: string;
  horaInicioISO: string;
  kmFinal: number | null;
  dataFimISO: string | null;
  horaFimISO: string | null;
  consumoReferencia: number | null;
  origemConsumo: string | null;
  precoReferencia: number | null;
  origemPreco: string | null;
  custoEstimado: number | null;
}

function vmToNew(vm: JornadaVM): NewJornada {
  return {
    kmInicial: vm.kmInicial,
    dataInicioISO: vm.dataInicioISO,
    horaInicioISO: vm.horaInicioISO,
  };
}

function vmToClose(vm: JornadaVM): CloseJornada {
  return {
    kmFinal: vm.kmFinal ?? 0,
    dataFimISO: vm.dataFimISO ?? '',
    horaFimISO: vm.horaFimISO ?? undefined,
    consumoReferencia: vm.consumoReferencia,
    origemConsumo: vm.origemConsumo as CloseJornada['origemConsumo'],
    precoReferencia: vm.precoReferencia,
    origemPreco: vm.origemPreco as CloseJornada['origemPreco'],
  };
}

declare global {
  interface Window {
    /** Chamado pelo monólito para abrir/encerrar uma jornada. */
    __motoboyJornada?: {
      start(vm: JornadaVM): Promise<string | null>;
      close(fsId: string | null | undefined, vm: JornadaVM): Promise<void>;
    };
    /** Definido pelo monólito; recebe as jornadas do Firestore e re-renderiza. */
    __applyRemoteJornada?: (entities: Jornada[]) => void;
  }
}

/** Instala o write-through para o monólito usar (deve rodar cedo, no boot). */
export function installJornadaBridge(): void {
  window.__motoboyJornada = {
    async start(vm) {
      try {
        const created = await jornadaService.start(vmToNew(vm));
        return created.id;
      } catch (error) {
        console.error('[Jornada] Erro ao iniciar:', error);
        return null; // offline/erro: fica só no cache local
      }
    },
    async close(fsId, vm) {
      if (!fsId) return;
      await jornadaService.close(fsId, vmToClose(vm));
    },
  };
}

/**
 * Carrega as jornadas do dono no Firestore e injeta no painel.
 * Nunca lança: retorna ok:false em caso de falha.
 */
export async function loadJornadaIntoPanel(): Promise<LoadResult<Jornada[]>> {
  try {
    const items = await jornadaService.list();
    window.__applyRemoteJornada?.(items);
    return loadOk(items);
  } catch (error) {
    console.error('[Jornada] Erro ao carregar:', error);
    return loadFail(error);
  }
}