/**
 * Escrita atômica de clientes em duas fontes Firestore.
 *
 * Fontes:
 * - users/{uid}/customers/{id}: perfil/identidade
 * - users/{uid}/clients/data: projeção financeira ({ clientes: [...] })
 *
 * Todas as operações CRUD usam runTransaction para atomicidade:
 * - Leitura de clients/data dentro da transação
 * - Escrita em customers/{id} + clients/data no mesmo commit
 * - Em falha, nenhuma fonte é alterada
 *
 * IDs são gerados pelo crypto.randomUUID() — único gerador.
 * O mesmo ID aparece em customers/{id} e em clients/data.
 *
 * IDs são pré-gerados ANTES de entrar no callback da transação.
 * O Firestore pode re-executar o callback em caso de contenção;
 * pré-gerar garante que o mesmo ID é usado em todas as tentativas.
 *
 * operationId usa apenas identificadores imutáveis (routeId + serviceId).
 * Se o mesmo operationId aparece com conteúdo diferente, a operação
 * é rejeitada como conflito — nunca cria duplicata nem sobrescreve
 * silenciosamente.
 *
 * Regras de CRUD:
 * - Todas as leituras acontecem antes das escritas no callback.
 * - Nenhuma Promise Firestore fica sem await.
 * - Operações de escrita usam tx.set/tx.update/tx.delete (nunca funções externas).
 * - Callback pode ser repetido pelo Firestore sem gerar IDs ou efeitos diferentes.
 */

import {
  doc,
  collection,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import { currentUid } from '../../auth/application/auth-service';
import type { LegacyCliente } from '../application/merge-legacy-customers';

export interface CreateClientInput {
  readonly name: string;
  readonly phone?: string;
  readonly nickname?: string;
  readonly notes?: string;
}

export interface UpdateClientInput {
  readonly name?: string;
  readonly phone?: string;
  readonly nickname?: string;
  readonly notes?: string;
  /** Nome antigo para localizar cliente legado sem ID. Obrigatório quando id é vazio. */
  readonly legacyLookupName?: string;
}

export interface RemoveClientOptions {
  /** Nome do cliente legado para localizar. Obrigatório quando id é vazio. */
  readonly legacyLookupName?: string;
}

export interface RoutePendingItem {
  readonly serviceId: string;
  readonly clientId?: string;
  readonly nome: string;
  readonly valor: number;
  readonly desc: string;
}

export interface ApplyReceiptInput {
  readonly clientId?: string;
  /** Nome exato usado apenas para localizar um cliente legado sem ID. */
  readonly legacyLookupName?: string;
  readonly valor: number;
  readonly dateISO: string;
  readonly dateLabel: string;
}

function usersCol(uid: string) {
  return collection(db, 'users', uid, 'customers');
}

function clientsDoc(uid: string) {
  return doc(db, 'users', uid, 'clients', 'data');
}

function generateId(_uid: string): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

function createConta(
  valor: number,
  desc: string,
  routeId: string,
  operationId: string,
  id: string,
  dateISO: string,
) {
  return {
    id,
    operationId,
    routeId,
    desc,
    valorOriginal: valor,
    recebido: 0,
    saldo: valor,
    status: 'open',
    data: 'Hoje',
    dateISO,
  };
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} obrigatório.`);
  return normalized;
}

/**
 * Verifica se há conflito: mesma operationId mas conteúdo diferente.
 * Lança erro se houver conflito — nunca cria duplicata nem sobrescreve.
 */
function assertNoConflict(
  existingConta: { operationId?: string; valorOriginal?: number; desc?: string } | undefined,
  incoming: { valor: number; desc: string },
  operationId: string,
): void {
  if (!existingConta) return;
  const sameContent =
    existingConta.valorOriginal === incoming.valor &&
    existingConta.desc === incoming.desc;
  if (!sameContent) {
    throw new Error(
      `Conflito de operationId "${operationId}": ` +
      `existente (valor=${existingConta.valorOriginal}, desc="${existingConta.desc}") × ` +
      `entrante (valor=${incoming.valor}, desc="${incoming.desc}")`,
    );
  }
}

/**
 * Cria cliente em ambas as fontes atomicamente.
 * Retorna o ID gerado.
 */
export async function createClientDual(input: CreateClientInput): Promise<string> {
  const uid = currentUid();
  if (!uid) throw new Error('Sem usuário autenticado.');

  const newId = generateId(uid);

  await runTransaction(db, async (tx) => {
    const clientsSnap = await tx.get(clientsDoc(uid));
    const existing: LegacyCliente[] = clientsSnap.exists()
      ? (clientsSnap.data().clientes as LegacyCliente[] ?? [])
      : [];

    tx.set(doc(usersCol(uid), newId), {
      name: input.name,
      phone: input.phone ?? null,
      nickname: input.nickname ?? null,
      notes: input.notes ?? null,
      status: 'active',
    });

    const newLegacy: LegacyCliente = {
      id: newId,
      nome: input.name,
      pendente: 0,
      contas: [],
      recebimentos: [],
    };

    tx.set(clientsDoc(uid), { clientes: [...existing, newLegacy] }, { merge: true });
  });

  return newId;
}

/**
 * Atualiza perfil em customers/{id} e nome na projeção financeira.
 * Ambas as escritas são atômicas.
 *
 * Se o cliente não tem ID (legado), executa migração transacional:
 * - Gera um ID estável (pré-gerado antes da transação)
 * - Cria customers/{id}
 * - Atualiza clients/data com o novo ID
 *
 * Para localizar legado sem ID, use legacyLookupName (nome antigo).
 * Rejeita se múltiplos clientes legados compartilham o mesmo nome.
 * Retorna o ID resolvido (original ou migrado).
 */
export async function updateClientDual(
  id: string,
  input: UpdateClientInput,
): Promise<string> {
  const uid = currentUid();
  if (!uid) throw new Error('Sem usuário autenticado.');

  if (!id && !input.legacyLookupName) {
    throw new Error('legacyLookupName é obrigatório para edição de cliente sem ID.');
  }

  const migrationId = !id ? generateId(uid) : null;
  let resolvedId = id;

  await runTransaction(db, async (tx) => {
    const clientsSnap = await tx.get(clientsDoc(uid));
    const existing: LegacyCliente[] = clientsSnap.exists()
      ? (clientsSnap.data().clientes as LegacyCliente[] ?? [])
      : [];

    const lookupName = (input.legacyLookupName || input.name || '').toLowerCase();
    const matchedLegacy = !id
      ? existing.filter((c) => !c.id && c.nome.toLowerCase() === lookupName)
      : [];

    if (!id && matchedLegacy.length === 0) {
      throw new Error(`Nenhum cliente legado encontrado com nome "${input.legacyLookupName}".`);
    }
    if (!id && matchedLegacy.length > 1) {
      throw new Error(
        `Conflito: existem ${matchedLegacy.length} clientes legados com nome "${input.legacyLookupName}". ` +
        `Edição não é possível — resolva manualmente no Firestore.`,
      );
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone ?? null;
    if (input.nickname !== undefined) patch.nickname = input.nickname ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;

    if (id) {
      if (Object.keys(patch).length > 0) {
        tx.update(doc(usersCol(uid), id), patch);
      }
    } else {
      const rid = migrationId!;
      resolvedId = rid;
      tx.set(doc(usersCol(uid), rid), {
        name: input.name ?? '',
        phone: input.phone ?? null,
        nickname: input.nickname ?? null,
        notes: input.notes ?? null,
        status: 'active',
      });
    }

    const currentId = id || migrationId!;
    const updated = existing.map((c) => {
      const matchesId = id && c.id === id;
      const matchesLegacy = !id && !c.id && c.nome.toLowerCase() === lookupName;
      if (matchesId || matchesLegacy) {
        const merged = { ...c, id: currentId };
        if (input.name !== undefined) merged.nome = input.name;
        return merged;
      }
      return c;
    });

    tx.set(clientsDoc(uid), { clientes: updated }, { merge: true });
  });

  return resolvedId!;
}

/**
 * Remove cliente de ambas as fontes atomicamente.
 *
 * Se o cliente não tem ID (legado), use options.legacyLookupName para localizar.
 * Rejeita se nenhum ou múltiplos clientes legados correspondem.
 * Remove a entrada financeira em clients/data.
 * Se existir customers/{id}, remove também.
 */
export async function removeClientDual(id: string, options?: RemoveClientOptions): Promise<void> {
  const uid = currentUid();
  if (!uid) throw new Error('Sem usuário autenticado.');

  if (!id && !options?.legacyLookupName) {
    throw new Error('legacyLookupName é obrigatório para exclusão de cliente sem ID.');
  }

  await runTransaction(db, async (tx) => {
    const clientsSnap = await tx.get(clientsDoc(uid));
    const existing: LegacyCliente[] = clientsSnap.exists()
      ? (clientsSnap.data().clientes as LegacyCliente[] ?? [])
      : [];

    let resolvedId = id;
    let target: LegacyCliente | undefined;

    if (id) {
      target = existing.find((c) => c.id === id);
    } else {
      const lookupName = options!.legacyLookupName!.toLowerCase();
      const matched = existing.filter((c) => !c.id && c.nome.toLowerCase() === lookupName);
      if (matched.length === 0) {
        throw new Error(`Nenhum cliente legado encontrado com nome "${options!.legacyLookupName}".`);
      }
      if (matched.length > 1) {
        throw new Error(
          `Conflito: existem ${matched.length} clientes legados com nome "${options!.legacyLookupName}". ` +
          `Exclusão não é possível — resolva manualmente no Firestore.`,
        );
      }
      target = matched[0];
      resolvedId = target.id || '';
    }

    if (resolvedId) {
      tx.delete(doc(usersCol(uid), resolvedId));
    }

    const filtered = existing.filter((c) => {
      if (id) return c.id !== id;
      return !(c.nome.toLowerCase() === options!.legacyLookupName!.toLowerCase() && !c.id);
    });
    tx.set(clientsDoc(uid), { clientes: filtered }, { merge: true });
  });
}

/**
 * Aplica todas as pendências de uma rota em uma única transação atômica.
 *
 * O writer recebe serviceId e constrói operationId como
 * ${routeId}:${serviceId} — apenas identificadores imutáveis.
 * Nome, valor e descrição são dados da operação, não parte da identidade.
 *
 * Se o mesmo operationId já existe com conteúdo diferente, lança erro
 * (conflito) — nunca cria duplicata nem sobrescreve silenciosamente.
 *
 * Pré-condições:
 * - IDs de novos clientes são pré-gerados antes da transação.
 * - Contas, datas e operationIds são preparados antes da transação.
 *
 * Dentro de uma única runTransaction:
 * 1. Lê clients/data uma vez.
 * 2. Para cada item: encontra ou cria o cliente, adiciona a conta.
 * 3. Grava todos os perfis novos (customers/{id}).
 * 4. Grava clients/data uma vez.
 *
 * Retorna o array completo de clientes atualizados.
 * Em falha, nenhuma fonte é alterada.
 */
export async function applyRoutePendingsDual(
  items: RoutePendingItem[],
  routeId: string,
): Promise<LegacyCliente[]> {
  const uid = currentUid();
  if (!uid) throw new Error('Sem usuário autenticado.');
  if (items.length === 0) return [];

  const normalizedRouteId = requiredIdentifier(routeId, 'routeId');
  const transactionDateISO = new Date().toISOString().slice(0, 10);
  const preparedItems = items.map((item) => {
    const serviceId = requiredIdentifier(
      item.serviceId,
      `serviceId da pendência do cliente "${item.nome}"`,
    );
    const operationId = `${normalizedRouteId}:${serviceId}`;
    return {
      ...item,
      serviceId,
      operationId,
      conta: createConta(
        item.valor,
        item.desc,
        normalizedRouteId,
        operationId,
        `conta-${generateId(uid)}`,
        transactionDateISO,
      ),
    };
  });

  const uniqueNames = [...new Set(
    preparedItems.filter((i) => !i.clientId).map((i) => i.nome.toLowerCase()),
  )];
  const idMap = new Map<string, string>();
  for (const name of uniqueNames) {
    idMap.set(name, generateId(uid));
  }

  let resultClientes: LegacyCliente[] = [];

  await runTransaction(db, async (tx) => {
    const clientsSnap = await tx.get(clientsDoc(uid));
    const existing: LegacyCliente[] = clientsSnap.exists()
      ? (clientsSnap.data().clientes as LegacyCliente[] ?? [])
      : [];

    let clientes = [...existing];
    const newProfiles: Array<{ id: string; nome: string }> = [];

    for (const item of preparedItems) {
      const nomeLower = item.nome.toLowerCase();

      // Busca global por operationId — protege contra contaminação cruzada
      let globalOwner: LegacyCliente | undefined;
      for (const c of clientes) {
        const globalHit = (c.contas ?? []).find(
          (ct) => (ct as { operationId?: string }).operationId === item.operationId,
        ) as { operationId?: string; valorOriginal?: number; desc?: string } | undefined;
        if (globalHit) {
          globalOwner = c;
          assertNoConflict(globalHit, { valor: item.valor, desc: item.desc }, item.operationId);
        }
      }
      if (globalOwner) {
        const expectedId = item.clientId || null;
        if (expectedId && globalOwner.id !== expectedId) {
          throw new Error(
            `Conflito de operationId "${item.operationId}": ` +
            `conta pertence ao cliente "${globalOwner.nome}" (${globalOwner.id}), ` +
            `mas item aponta para clientId "${expectedId}".`,
          );
        }
        continue;
      }

      // Identidade: clientId primeiro, nome como fallback legado
      let client: LegacyCliente | undefined;
      if (item.clientId) {
        client = clientes.find((c) => c.id === item.clientId);
        if (!client) {
          throw new Error(
            `Cliente não encontrado para clientId "${item.clientId}". ` +
            `Não é permitido criar cliente por nome quando clientId é fornecido.`,
          );
        }
      } else {
        const nameMatches = clientes.filter((c) => c.nome.toLowerCase() === nomeLower);
        if (nameMatches.length > 1) {
          throw new Error(
            `Ambiguidade: ${nameMatches.length} clientes com nome "${item.nome}". ` +
            `Informe clientId para identificar corretamente.`,
          );
        }
        client = nameMatches[0];
      }

      if (!client) {
        const newId = idMap.get(nomeLower)!;
        newProfiles.push({ id: newId, nome: item.nome });

        client = {
          id: newId,
          nome: item.nome,
          pendente: 0,
          contas: [],
          recebimentos: [],
        };
        clientes = [...clientes, client];
      }

      const newConta = { ...item.conta };

      const matchId = client.id;
      const updatedClient: LegacyCliente = {
        ...client,
        contas: [newConta, ...(client.contas ?? [])],
        pendente:
          (client.pendente ?? 0) +
          Math.max(0, newConta.saldo),
      };

      clientes = clientes.map((c) =>
        (matchId && c.id === matchId) || c === client
          ? updatedClient
          : c,
      );
    }

    for (const profile of newProfiles) {
      tx.set(doc(usersCol(uid), profile.id), {
        name: profile.nome,
        phone: null,
        nickname: null,
        notes: null,
        status: 'active',
      });
    }

    tx.set(clientsDoc(uid), { clientes }, { merge: true });

    resultClientes = clientes;
  });

  return resultClientes;
}

/**
 * Aplica um recebimento FIFO sobre a projeção financeira mais recente.
 *
 * A leitura e a escrita de clients/data pertencem à mesma transação. Assim,
 * uma confirmação de recebimento concorrente com cancelRouteDual é
 * serializada pelo Firestore: ou o recebimento vence e bloqueia o
 * cancelamento, ou o cancelamento vence e o recebimento encontra saldo zero.
 *
 * O registro do recebimento é preparado antes de runTransaction para que uma
 * reexecução do callback use exatamente os mesmos dados.
 */
export async function applyReceiptDual(
  input: ApplyReceiptInput,
): Promise<LegacyCliente[]> {
  const uid = currentUid();
  if (!uid) throw new Error('Sem usuário autenticado.');
  if (!Number.isFinite(input.valor) || input.valor <= 0) {
    throw new Error('valor do recebimento deve ser maior que zero.');
  }
  if (!input.clientId && !input.legacyLookupName?.trim()) {
    throw new Error('clientId ou legacyLookupName é obrigatório para recebimento.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateISO)) {
    throw new Error('dateISO inválida para recebimento.');
  }

  const preparedReceipt = {
    id: `receipt-${generateId(uid)}`,
    valor: input.valor,
    data: requiredIdentifier(input.dateLabel, 'dateLabel'),
    dateISO: input.dateISO,
  };
  let resultClientes: LegacyCliente[] = [];

  await runTransaction(db, async (tx) => {
    const clientsSnap = await tx.get(clientsDoc(uid));
    const existing: LegacyCliente[] = clientsSnap.exists()
      ? (clientsSnap.data().clientes as LegacyCliente[] ?? [])
      : [];

    let targetIndex = -1;
    if (input.clientId) {
      targetIndex = existing.findIndex((client) => client.id === input.clientId);
      if (targetIndex < 0) {
        throw new Error(`Cliente não encontrado para clientId "${input.clientId}".`);
      }
    } else {
      const lookupName = input.legacyLookupName!.trim().toLowerCase();
      const matches = existing
        .map((client, index) => ({ client, index }))
        .filter(({ client }) => !client.id && client.nome.trim().toLowerCase() === lookupName);
      if (matches.length === 0) {
        throw new Error(
          `Nenhum cliente legado encontrado com nome "${input.legacyLookupName}".`,
        );
      }
      if (matches.length > 1) {
        throw new Error(
          `Conflito: existem ${matches.length} clientes legados com nome ` +
          `"${input.legacyLookupName}". Recebimento não é possível sem clientId.`,
        );
      }
      targetIndex = matches[0].index;
    }

    const target = existing[targetIndex];
    const contas = Array.isArray(target.contas)
      ? (target.contas as Array<Record<string, unknown>>).map((conta) => ({ ...conta }))
      : [];
    const saldoDisponivel = contas.reduce(
      (sum, conta) => sum + Math.max(0, Number(conta.saldo) || 0),
      0,
    );
    if (input.valor > saldoDisponivel + 0.001) {
      throw new Error(
        `O valor recebido excede o saldo pendente atual de ${saldoDisponivel}.`,
      );
    }

    let restante = input.valor;
    for (let index = contas.length - 1; index >= 0 && restante > 0; index -= 1) {
      const conta = contas[index];
      const saldo = Math.max(0, Number(conta.saldo) || 0);
      if (saldo <= 0) continue;

      const aplicado = Math.min(restante, saldo);
      const novoSaldo = saldo - aplicado;
      conta.recebido = (Number(conta.recebido) || 0) + aplicado;
      conta.saldo = novoSaldo;
      conta.status = novoSaldo <= 0.001 ? 'paid' : 'partial';
      restante -= aplicado;
    }

    const pendente = contas.reduce(
      (sum, conta) => sum + Math.max(0, Number(conta.saldo) || 0),
      0,
    );
    const updatedClient: LegacyCliente = {
      ...target,
      contas,
      pendente,
      recebimentos: [
        { ...preparedReceipt },
        ...(Array.isArray(target.recebimentos) ? target.recebimentos : []),
      ],
    };
    const clientes = existing.map((client, index) =>
      index === targetIndex ? updatedClient : client,
    );

    tx.set(clientsDoc(uid), { clientes }, { merge: true });
    resultClientes = clientes;
  });

  return resultClientes;
}

/**
 * Cancela uma rota e remove atomicamente todas as contas associadas dos clientes.
 *
 * Dentro de uma única runTransaction:
 * 1. Lê o documento da rota (verifica existência).
 * 2. Lê clients/data.
 * 3. Verifica no dado remoto que nenhuma conta da rota possui recebido > 0.
 * 4. Filtra as contas com routeId correspondente de todos os clientes.
 * 5. Recalcula pendente de cada cliente afetado.
 * 6. Grava clients/data atualizado.
 * 7. Remove o documento da rota (tx.delete).
 *
 * Em falha, nenhuma fonte é alterada.
 *
 * Retorna o array de clientes atualizado.
 */
export async function cancelRouteDual(
  routeId: string,
): Promise<LegacyCliente[]> {
  const uid = currentUid();
  if (!uid) throw new Error('Sem usuário autenticado.');
  if (!routeId) throw new Error('routeId obrigatório para cancelamento.');

  let resultClientes: LegacyCliente[] = [];

  const rotaRef = doc(collection(db, 'users', uid, 'rotas'), routeId);

  await runTransaction(db, async (tx) => {
    const rotaSnap = await tx.get(rotaRef);
    if (!rotaSnap.exists()) {
      throw new Error(`Rota ${routeId} não encontrada.`);
    }

    const clientsSnap = await tx.get(clientsDoc(uid));
    const existing: LegacyCliente[] = clientsSnap.exists()
      ? (clientsSnap.data().clientes as LegacyCliente[] ?? [])
      : [];

    for (const c of existing) {
      for (const conta of (c.contas ?? []) as Array<Record<string, unknown>>) {
        if (conta.routeId === routeId && (Number(conta.recebido) || 0) > 0) {
          throw new Error(
            `O cliente ${c.nome} já recebeu pagamento referente a esta rota. ` +
            `Trate o recebimento antes de cancelar.`,
          );
        }
      }
    }

    const clientes = existing.map((c) => {
      const contas = (c.contas ?? []) as Array<Record<string, unknown>>;
      const filtered = contas.filter(
        (conta) => conta.routeId !== routeId,
      );
      if (filtered.length === contas.length) return c;

      const pendente = filtered.reduce(
        (sum, conta) => sum + Math.max(0, Number(conta.saldo) || 0),
        0,
      );
      return { ...c, contas: filtered, pendente };
    });

    tx.set(clientsDoc(uid), { clientes }, { merge: true });
    tx.delete(rotaRef);

    resultClientes = clientes;
  });

  return resultClientes;
}
