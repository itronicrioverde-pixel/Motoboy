/** Tentativas de criação isoladas por UID e independentes do cache legado do painel. */
import {
  isDurableCreateAttempt,
  type DurableCreateAttempt,
  type DurableCreateKind,
  type DurableCreateStore,
} from '../application/durable-create-manager';

export interface DurableCreateStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// V1 permanece legível para não perder tentativas preparadas antes da migração.
export const DURABLE_CREATE_STORAGE_PREFIX = 'motoboy.durable-create.v1';
export const DURABLE_CREATE_ATTEMPT_STORAGE_PREFIX = 'motoboy.durable-create.v2';

export function durableCreateStorageKey(uid: string): string {
  return `${DURABLE_CREATE_STORAGE_PREFIX}.${encodeURIComponent(uid)}`;
}

function attemptPrefix(uid: string): string {
  // encodeURIComponent não escapa pontos; separá-los evita sobreposição entre UIDs.
  return `${DURABLE_CREATE_ATTEMPT_STORAGE_PREFIX}.${encodeURIComponent(uid).replaceAll('.', '%2E')}.`;
}

export function durableCreateAttemptStorageKey(uid: string, kind: DurableCreateKind, id: string): string {
  return `${attemptPrefix(uid)}${kind}.${id}`;
}

interface ConfirmedTombstone {
  readonly status: 'confirmed';
  readonly uid: string;
  readonly kind: DurableCreateKind;
  readonly id: string;
}

function isConfirmedTombstone(value: unknown, uid: string, key: string): value is ConfirmedTombstone {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(',') === 'id,kind,status,uid'
    && item.status === 'confirmed'
    && item.uid === uid
    && (item.kind === 'abastecimentos' || item.kind === 'manutencoes' || item.kind === 'entradas')
    && typeof item.id === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(item.id)
    && durableCreateAttemptStorageKey(uid, item.kind, item.id) === key;
}

export function createLocalStorageDurableCreateStore(storage?: DurableCreateStorage): DurableCreateStore {
  const backend = storage ?? (globalThis as { localStorage?: DurableCreateStorage }).localStorage;

  function readStrict(uid: string): DurableCreateAttempt[] {
    if (!uid || !backend) throw new Error('Storage de tentativas indisponível.');
    const raw = backend.getItem(durableCreateStorageKey(uid));
    let legacy: unknown = [];
    if (raw !== null) {
      try { legacy = JSON.parse(raw); } catch { throw new Error('Tentativas locais corrompidas; nenhuma foi sobrescrita.'); }
      if (!Array.isArray(legacy) || !legacy.every((item) => isDurableCreateAttempt(item) && item.uid === uid)) {
        throw new Error('Tentativas locais inválidas; nenhuma foi sobrescrita.');
      }
    }
    const pending = new Map<string, DurableCreateAttempt>();
    for (const item of legacy as DurableCreateAttempt[]) {
      const key = durableCreateAttemptStorageKey(uid, item.kind, item.id);
      const prior = pending.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(item)) {
        throw new Error('ID de tentativa já existe com payload diferente.');
      }
      pending.set(key, item);
    }
    const prefix = attemptPrefix(uid);
    for (let index = 0; index < backend.length; index += 1) {
      const key = backend.key(index);
      if (!key?.startsWith(prefix)) continue;
      const encoded = backend.getItem(key);
      if (encoded === null) continue;
      let item: unknown;
      try { item = JSON.parse(encoded); } catch { throw new Error('Tentativas locais corrompidas; nenhuma foi sobrescrita.'); }
      if (isConfirmedTombstone(item, uid, key)) {
        pending.delete(key);
      } else if (isDurableCreateAttempt(item) && item.uid === uid
        && durableCreateAttemptStorageKey(uid, item.kind, item.id) === key) {
        const prior = pending.get(key);
        if (prior && JSON.stringify(prior) !== JSON.stringify(item)) {
          throw new Error('ID de tentativa já existe com payload diferente.');
        }
        pending.set(key, item);
      } else {
        throw new Error('Tentativas locais inválidas; nenhuma foi sobrescrita.');
      }
    }
    return [...pending.values()];
  }

  function list(uid: string): DurableCreateAttempt[] {
    return readStrict(uid);
  }

  function save(attempt: DurableCreateAttempt): void {
    if (!isDurableCreateAttempt(attempt)) throw new Error('Tentativa de criação inválida.');
    const existing = readStrict(attempt.uid);
    const duplicate = existing.find((item) => item.kind === attempt.kind && item.id === attempt.id);
    if (duplicate) {
      if (JSON.stringify(duplicate) === JSON.stringify(attempt)) return;
      throw new Error('ID de tentativa já existe com payload diferente.');
    }
    const key = durableCreateAttemptStorageKey(attempt.uid, attempt.kind, attempt.id);
    if (backend!.getItem(key) !== null) throw new Error('ID de tentativa já foi confirmado.');
    const encoded = JSON.stringify(attempt);
    backend!.setItem(key, encoded);
    if (backend!.getItem(key) !== encoded) {
      throw new Error('Tentativa não permaneceu gravada no armazenamento local.');
    }
  }

  function clear(uid: string, kind: DurableCreateKind, id: string): void {
    const existing = readStrict(uid);
    if (!existing.some((item) => item.kind === kind && item.id === id)) return;
    const key = durableCreateAttemptStorageKey(uid, kind, id);
    // Tombstone elimina a tentativa V1 sem reescrever o array compartilhado.
    const encoded = JSON.stringify({ status: 'confirmed', uid, kind, id } satisfies ConfirmedTombstone);
    backend!.setItem(key, encoded);
    if (backend!.getItem(key) !== encoded) {
      throw new Error('Tentativa confirmada não foi removida do armazenamento local.');
    }
  }

  return { list, save, clear };
}
