/**
 * Ponte entre o painel legado e a feature Payments (strangler pattern).
 * Expõe window.__motoboyPayments para o monólito.
 */

import { paymentsService } from '../index';
import type { Payment } from '../index';

declare global {
  interface Window {
    __motoboyPayments?: {
      list(): Promise<Payment[]>;
      listByClient(clientId: string): Promise<Payment[]>;
      save(payment: Payment): Promise<void>;
      remove(id: string): Promise<void>;
    };
    __applyRemotePayments?: (entities: Payment[]) => void;
  }
}

export function installPaymentsBridge(): void {
  window.__motoboyPayments = {
    async list() {
      try {
        return await paymentsService.list();
      } catch (error) {
        console.error('[Pagamentos] Erro ao listar:', error);
        return [];
      }
    },
    async listByClient(clientId) {
      try {
        return await paymentsService.listByClient(clientId);
      } catch (error) {
        console.error('[Pagamentos] Erro ao listar por cliente:', error);
        return [];
      }
    },
    async save(payment) {
      try {
        await paymentsService.save(payment);
      } catch (error) {
        console.error('[Pagamentos] Erro ao salvar:', error);
        /* offline/erro */
      }
    },
    async remove(id) {
      try {
        await paymentsService.remove(id);
      } catch (error) {
        console.error('[Pagamentos] Erro ao remover:', error);
        /* offline/erro */
      }
    },
  };
}

export async function loadPaymentsIntoPanel(): Promise<void> {
  try {
    const items = await paymentsService.list();
    window.__applyRemotePayments?.(items);
  } catch (error) {
    console.error('[Pagamentos] Erro ao carregar:', error);
    /* offline/sem permissão: mantém o cache local */
  }
}
