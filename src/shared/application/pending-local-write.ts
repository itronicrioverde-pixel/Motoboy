/**
 * Ciclo de vida de uma escrita local do painel legado: "pendente → salvo" e
 * "pendente → falhou", mais a mescla de carga remota sem apagar pendências.
 *
 * O painel mantém em memória/localStorage a fonte de verdade da UI enquanto o
 * Firestore é a persistência remota. Este módulo (sem Firebase, DOM ou
 * localStorage) centraliza as regras dessas transições para abastecimentos,
 * manutenções e entradas manuais:
 *  - só confirma "salvo" quando o id remoto chega;
 *  - marca "falhou" sem descartar o registro nem avisar sucesso;
 *  - protege contra exclusão durante uma criação ainda pendente (limpeza de
 *    documento órfão que confirme depois);
 *  - ignora a conclusão quando o dono da sessão muda durante a escrita;
 *  - mescla a carga remota preservando as pendências locais (recarga
 *    concorrente com uma gravação em andamento).
 *
 * Nunca faz retry que crie registros duplicados: quem chama é responsável por
 * bloquear o reenvio (lock) e por substituir o registro no lugar (sem novo
 * insert) quando o usuário tentar de novo.
 */

export type LocalWriteStatus = 'saved' | 'pending' | 'failed';

export interface LocalSyncRecord {
  fsId?: string | null;
  syncState?: LocalWriteStatus;
}

export interface LocalWriteCallbacks<T extends LocalSyncRecord> {
  /** O registro ainda está presente na lista local (não foi excluído/substituído). */
  isPresent(record: T): boolean;
  /** O dono da sessão no momento da conclusão ainda é o do início da escrita. */
  isSameOwner(): boolean;
  /** O id remoto foi confirmado e precisa ser aplicado ao registro. */
  onPersistenceConfirmed(record: T, remoteId: string): void;
  /** A escrita remota falhou (rede/erro). O registro fica "falhou". */
  onPersistenceFailed(record: T, cause: unknown): void;
  /** O add pendente foi excluído localmente e o id remoto chegou depois: remover no remoto. */
  onOrphanRemoval(remoteId: string): void;
  /** Sempre ao final (sucesso/erro): libera o lock anti duplo envio. */
  onSettled(): void;
}

export async function settleLocalAdd<T extends LocalSyncRecord>(
  record: T,
  remoteAdd: ((r: T) => Promise<string | null | undefined>) | undefined,
  callbacks: LocalWriteCallbacks<T>,
): Promise<void> {
  record.syncState = 'pending';
  if (typeof remoteAdd !== 'function') {
    // Sem ponte: o registro fica somente local e pendente (não perde o dado).
    callbacks.onSettled();
    return;
  }
  try {
    const remoteId = await remoteAdd(record);
    if (!callbacks.isPresent(record)) {
      // Exclusão durante a criação pendente: limpa o órfão remoto se ele chegou.
      if (typeof remoteId === 'string' && remoteId) callbacks.onOrphanRemoval(remoteId);
      return;
    }
    if (!callbacks.isSameOwner()) return;
    if (typeof remoteId === 'string' && remoteId) {
      record.fsId = remoteId;
      record.syncState = 'saved';
      callbacks.onPersistenceConfirmed(record, remoteId);
    } else {
      record.syncState = 'failed';
      callbacks.onPersistenceFailed(record, new Error('o remoto não confirmou um id'));
    }
  } catch (cause) {
    if (!callbacks.isPresent(record)) return;
    if (!callbacks.isSameOwner()) return;
    record.syncState = 'failed';
    callbacks.onPersistenceFailed(record, cause);
  } finally {
    callbacks.onSettled();
  }
}

export interface RemoteWriteCallbacks<T extends LocalSyncRecord> {
  /** O dono da sessão não mudou durante a escrita. */
  isSameOwner(): boolean;
  /** A escrita remota falhou: o registro NÃO deve ser alterado localmente. */
  onPersistenceFailed(record: T, cause: unknown): void;
  /** Sempre ao final: libera o lock anti duplo envio. */
  onSettled(): void;
}

/**
 * Executa update/remove remoto aguardando a confirmação antes de o chamador
 * aplicar qualquer mudança local. Retorna true somente quando o remoto confirmou
 * e o dono continuou o mesmo. Nunca lança.
 */
export async function runRemoteWrite<T extends LocalSyncRecord>(
  record: T,
  runRemote: (() => Promise<unknown>) | undefined,
  callbacks: RemoteWriteCallbacks<T>,
): Promise<boolean> {
  if (typeof runRemote !== 'function') {
    callbacks.onPersistenceFailed(record, new Error('ponte de persistência indisponível'));
    callbacks.onSettled();
    return false;
  }
  try {
    await runRemote();
  } catch (cause) {
    callbacks.onPersistenceFailed(record, cause);
    return false;
  } finally {
    callbacks.onSettled();
  }
  if (!callbacks.isSameOwner()) return false;
  return true;
}

/**
 * Mescla uma carga remota com a lista local preservando as pendências.
 * Registros remotos vencem sempre. Registros locais ainda sem id remoto
 * (pendentes ou falhos, aguardando confirmação) continuam no painel para não
 * apagar o trabalho de uma gravação em andamento durante uma recarga
 * concorrente.
 */
export function mergeRemoteWithPending<T extends LocalSyncRecord>(
  remote: T[],
  local: T[],
): T[] {
  const preserved = local.filter((item) => !(typeof item.fsId === 'string' && item.fsId));
  return [...remote, ...preserved];
}