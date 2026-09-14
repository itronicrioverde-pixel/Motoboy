/**
 * Ponte entre o painel legado e a feature Customers (strangler pattern).
 * Expõe window.__motoboyCustomers para o monólito CRUD de clientes.
 *
 * O domínio Customer usa `name`, mas o painel legado espera `nome` +
 * arrays `contas` e `recebimentos`. A loadCustomersIntoPanel mapeia
 * antes de enviar para __applyRemoteClientes.
 *
 * Hidratação: retorna dados brutos para main.ts orquestrar a hidratação
 * individual, preservando dados financeiros locais que o domínio novo não carrega.
 */

import { customersService } from '../index';
import type { Customer } from '../index';
import type { LoadResult } from '../../abastecimentos/presentation/panel-bridge';

/** Formato legado esperado pelo painel (panel.js). */
interface LegacyCliente {
  nome: string;
  pendente: number;
  contas: unknown[];
  recebimentos: unknown[];
}

/** Converte Customer (domínio) → formato legado do painel. */
function customerToLegacy(c: Customer): LegacyCliente {
  return {
    nome: c.name,
    pendente: 0,
    contas: [],
    recebimentos: [],
  };
}

declare global {
  interface Window {
    __motoboyCustomers?: {
      list(): Promise<Customer[]>;
      create(data: { name: string; phone?: string; nickname?: string; notes?: string }): Promise<string>;
      update(id: string, data: { name?: string; phone?: string; nickname?: string; notes?: string }): Promise<void>;
      archive(id: string): Promise<void>;
      remove(id: string): Promise<void>;
    };
    __applyRemoteClientes?: (entities: LegacyCliente[]) => void;
  }
}

export function installCustomersBridge(): void {
  window.__motoboyCustomers = {
    async list() {
      try {
        return await customersService.list();
      } catch (error) {
        console.error('[Clientes] Erro ao listar:', error);
        return [];
      }
    },
    async create(data) {
      try {
        const created = await customersService.create(data);
        return created.id;
      } catch (error) {
        console.error('[Clientes] Erro ao criar:', error);
        return '';
      }
    },
    async update(id, data) {
      try {
        await customersService.update(id, data);
      } catch (error) {
        console.error('[Clientes] Erro ao atualizar:', error);
        /* offline/erro */
      }
    },
    async archive(id) {
      try {
        await customersService.archive(id);
      } catch (error) {
        console.error('[Clientes] Erro ao arquivar:', error);
        /* offline/erro */
      }
    },
    async remove(id) {
      try {
        await customersService.remove(id);
      } catch (error) {
        console.error('[Clientes] Erro ao remover:', error);
        /* offline/erro */
      }
    },
  };
}

/**
 * Carrega os clientes do Firestore e retorna no formato legado.
 * Retorna sucesso com dados, vazio ou falha explicitamente.
 * Erro capturado NÃO é considerado carregamento concluído.
 * A hidratação do painel é feita por main.ts via __hydrateClientes.
 */
export async function loadCustomersIntoPanel(): Promise<LoadResult<LegacyCliente[]>> {
  const items = await customersService.list();
  const legacy = items.map(customerToLegacy);
  return { ok: true, data: legacy };
}
