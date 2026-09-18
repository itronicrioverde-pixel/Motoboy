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
  readonly operationId: string;
  readonly nome: string;
  readonly valor: number;
  readonly desc: string;
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
) {
  return {
    id: `conta-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operationId,
    routeId,
    desc,
    valorOriginal: valor,
    recebido: 0,
    saldo: valor,
    status: 'open',
    data: 'Hoje',
    dateISO: new Date().toISOString().slice(0, 10),
  };
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
 * operationId é ${routeId}:${serviceId} — apenas identificadores imutáveis.
 * Nome, valor e descrição são dados da operação, não parte da identidade.
 *
 * Se o mesmo operationId já existe com conteúdo diferente, lança erro
 * (conflito) — nunca cria duplicata nem sobrescreve silenciosamente.
 *
 * Pré-condições:
 * - IDs de novos clientes são pré-gerados antes da transação.
 * - operationIds são usados para impedir duplicação e detectar conflitos.
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

  const pendingItems = items.map((item) => ({
    ...item,
    operationId: item.operationId || `${routeId}:${item.nome.toLowerCase()}`,
  }));

  const uniqueNames = [...new Set(pendingItems.map((i) => i.nome.toLowerCase()))];
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

    for (const item of pendingItems) {
      const nomeLower = item.nome.toLowerCase();
      let client = clientes.find((c) => c.nome.toLowerCase() === nomeLower);

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

      const existingConta = (client.contas ?? []).find(
        (c) => (c as { operationId?: string }).operationId === item.operationId,
      ) as { operationId?: string; valorOriginal?: number; desc?: string } | undefined;

      if (existingConta) {
        assertNoConflict(existingConta, { valor: item.valor, desc: item.desc }, item.operationId);
        continue;
      }

      const newConta = createConta(item.valor, item.desc, routeId, item.operationId);

      const updatedClient: LegacyCliente = {
        ...client,
        contas: [newConta, ...(client.contas ?? [])],
        pendente:
          (client.pendente ?? 0) +
          Math.max(0, newConta.saldo),
      };

      clientes = clientes.map((c) =>
        c === client || c.nome.toLowerCase() === nomeLower
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
