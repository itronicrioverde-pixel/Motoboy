/**
 * Ponte entre o painel legado e a feature Customers (strangler pattern).
 * Expõe window.__motoboyCustomers para o monólito CRUD de clientes.
 */

import { customersService } from '../index';
import type { Customer } from '../index';

declare global {
  interface Window {
    __motoboyCustomers?: {
      list(): Promise<Customer[]>;
      create(data: { name: string; phone?: string; nickname?: string; notes?: string }): Promise<string>;
      update(id: string, data: { name?: string; phone?: string; nickname?: string; notes?: string }): Promise<void>;
      archive(id: string): Promise<void>;
      remove(id: string): Promise<void>;
    };
    __applyRemoteCustomers?: (entities: Customer[]) => void;
  }
}

export function installCustomersBridge(): void {
  window.__motoboyCustomers = {
    async list() {
      try {
        return await customersService.list();
      } catch {
        return [];
      }
    },
    async create(data) {
      try {
        const created = await customersService.create(data);
        return created.id;
      } catch {
        return '';
      }
    },
    async update(id, data) {
      try {
        await customersService.update(id, data);
      } catch {
        /* offline/erro */
      }
    },
    async archive(id) {
      try {
        await customersService.archive(id);
      } catch {
        /* offline/erro */
      }
    },
    async remove(id) {
      try {
        await customersService.remove(id);
      } catch {
        /* offline/erro */
      }
    },
  };
}

export async function loadCustomersIntoPanel(): Promise<void> {
  try {
    const items = await customersService.list();
    window.__applyRemoteCustomers?.(items);
  } catch {
    /* offline/sem permissão: mantém o cache local */
  }
}
