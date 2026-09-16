/**
 * Merge puro entre clientes remotos (Firestore) e clientes locais (localStorage).
 *
 * Regras:
 * - ID estável é a chave primária de associação.
 * - Nome normalizado é fallback apenas para registros legados sem ID.
 * - Dados financeiros locais (contas, recebimentos, pendente) são preservados
 *   quando o remoto não os carrega.
 * - Cliente remoto novo inicia sem dados financeiros locais.
 * - Cliente local sem correspondência remota é preservado intacto.
 * - Objetos recebidos nunca são mutados; novos objetos são criados.
 */

export interface LegacyCliente {
  readonly id?: string;
  readonly nome: string;
  readonly pendente: number;
  readonly contas: unknown[];
  readonly recebimentos: unknown[];
  readonly [key: string]: unknown;
}

export interface MergeResult {
  readonly merged: LegacyCliente[];
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

export function mergeLegacyCustomers(
  remoteClientes: ReadonlyArray<LegacyCliente>,
  localClientes: ReadonlyArray<LegacyCliente>,
): MergeResult {
  const localById = new Map<string, LegacyCliente>();
  const localByName = new Map<string, LegacyCliente[]>();
  const matchedLocals = new Set<LegacyCliente>();

  for (const local of localClientes) {
    if (local.id) {
      localById.set(local.id, local);
    }
    const key = normalizeName(local.nome);
    const list = localByName.get(key);
    if (list) list.push(local);
    else localByName.set(key, [local]);
  }

  const merged: LegacyCliente[] = [];

  for (const remote of remoteClientes) {
    let local: LegacyCliente | undefined;

    if (remote.id) {
      local = localById.get(remote.id);
      if (local) {
        matchedLocals.add(local);
      }
    }

    if (!local) {
      const nameKey = normalizeName(remote.nome);
      const candidates = localByName.get(nameKey);
      if (candidates) {
        const candidate = candidates.find(c => !c.id && !matchedLocals.has(c));
        if (candidate) {
          local = candidate;
          matchedLocals.add(local);
        }
      }
    }

    if (local) {
      merged.push({
        ...remote,
        contas: hasFinancialData(remote) ? remote.contas : [...local.contas],
        recebimentos: hasFinancialData(remote) ? remote.recebimentos : [...local.recebimentos],
        pendente: hasFinancialData(remote) ? remote.pendente : local.pendente,
      });
    } else {
      merged.push({
        ...remote,
        contas: remote.contas ?? [],
        recebimentos: remote.recebimentos ?? [],
        pendente: remote.pendente ?? 0,
      });
    }
  }

  for (const local of localClientes) {
    if (!matchedLocals.has(local)) {
      merged.push({ ...local });
    }
  }

  return { merged };
}

function hasFinancialData(cliente: LegacyCliente): boolean {
  return (
    (Array.isArray(cliente.contas) && cliente.contas.length > 0) ||
    (Array.isArray(cliente.recebimentos) && cliente.recebimentos.length > 0)
  );
}
