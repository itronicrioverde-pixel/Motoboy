/**
 * Ponte entre o painel legado e a feature Customers (strangler pattern).
 * Expõe window.__motoboyCustomers para o monólito CRUD de clientes.
 *
 * Duas fontes remotas:
 * - customers/{customerId}: perfil/identidade (nome, telefone, apelido, notas, status)
 * - clients/data: projeção financeira legada (contas, recebimentos, pendente)
 *
 * loadCustomersIntoPanel() carrega ambas em paralelo, merge por ID estável,
 * e retorna o resultado unificado. Hidratação do painel é feita por main.ts
 * via __hydrateClientes.
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import { currentUid } from '../../auth/application/auth-service';
import { customersService } from '../index';
import type { Customer } from '../index';
import { mergeLegacyCustomers, type LegacyCliente } from '../application/merge-legacy-customers';
import type { LoadResult } from '../../../shared/application/load-result';
import { loadOk, loadFail } from '../../../shared/application/load-result';

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
 * Lê a projeção financeira legada de users/{uid}/clients/data.
 * Documento inexistente retorna array vazio (projeção válida = vazia).
 * Falha de rede/permissão propaga o erro (não é documento inexistente).
 */
async function loadFinancialProjection(): Promise<LegacyCliente[]> {
  const uid = currentUid();
  if (!uid) return [];
  const snap = await getDoc(doc(db, 'users', uid, 'clients', 'data'));
  if (!snap.exists()) return [];
  const raw = snap.data();
  return Array.isArray(raw?.clientes) ? raw.clientes : [];
}

/**
 * Converte Customer (domínio) → formato legado do painel.
 * Inclui o ID estável para merge por ID.
 */
function customerToLegacy(c: Customer): LegacyCliente {
  return {
    id: c.id,
    nome: c.name,
    pendente: 0,
    contas: [],
    recebimentos: [],
  };
}

/**
 * Carrega os clientes do Firestore e retorna no formato legado.
 * Duas fontes em paralelo:
 * - customers/{id}: perfil/identidade
 * - clients/data: projeção financeira legada
 *
 * Merge por ID estável (mergeLegacyCustomers).
 * Nunca lança: retorna ok:false em caso de falha no perfil.
 * Falha ao ler clients/data mantém sync bloqueada (retorna erro).
 */
export async function loadCustomersIntoPanel(): Promise<LoadResult<LegacyCliente[]>> {
  try {
    const [profileItems, financialProjection] = await Promise.all([
      customersService.list(),
      loadFinancialProjection().catch((error) => {
        console.error('[Clientes] Erro ao ler projeção financeira:', error);
        // Falha ao ler clients/data propaga erro — impede hidratação.
        throw error;
      }),
    ]);

    const profile = profileItems.map(customerToLegacy);
    const { merged } = mergeLegacyCustomers(profile, financialProjection);
    return loadOk(merged);
  } catch (error) {
    console.error('[Clientes] Erro ao carregar:', error);
    return loadFail(error);
  }
}
