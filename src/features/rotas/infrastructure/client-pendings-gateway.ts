import {
  applyRoutePendingsDual,
  type RoutePendingItem as ClientWriterPendingItem,
} from '../../customers/infrastructure/client-writer';
import type { LegacyCliente } from '../../customers/application/merge-legacy-customers';
import type { RoutePendingItem } from '../application/route-confirmation-orchestrator';

/**
 * Fronteira tipada entre o orquestrador de Rotas e o writer financeiro de
 * Clientes. A cópia explícita mantém o contrato readonly da application e faz
 * mudanças incompatíveis em client-writer falharem no typecheck.
 */
export async function applyRouteFinancialPendings(
  items: readonly RoutePendingItem[],
  routeId: string,
): Promise<LegacyCliente[]> {
  const clientItems: ClientWriterPendingItem[] = items.map((item) => ({
    serviceId: item.serviceId,
    ...(item.clientId ? { clientId: item.clientId } : {}),
    nome: item.nome,
    valor: item.valor,
    desc: item.desc,
  }));
  return applyRoutePendingsDual(clientItems, routeId);
}
