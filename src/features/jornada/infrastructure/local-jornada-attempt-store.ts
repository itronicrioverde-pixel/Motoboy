import type { JornadaViewRecord } from '../presentation/jornada-merge';

export interface JornadaAttempt extends JornadaViewRecord {
  pendingCreateId: string;
  pendingUid: string;
  fsId: null;
  status: 'open';
}

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'motoboy-jornada-attempt-v1:';

function key(uid: string, id: string): string {
  if (!uid || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Identidade da tentativa inválida.');
  return `${PREFIX}${encodeURIComponent(uid)}:${id}`;
}

function validAttempt(value: unknown, uid: string): value is JornadaAttempt {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<JornadaAttempt>;
  return item.pendingUid === uid
    && typeof item.pendingCreateId === 'string'
    && /^[a-zA-Z0-9_-]+$/.test(item.pendingCreateId)
    && item.fsId === null && item.status === 'open'
    && typeof item.kmInicial === 'number' && Number.isFinite(item.kmInicial)
    && typeof item.dataInicioISO === 'string'
    && typeof item.horaInicioISO === 'string';
}

/** Tentativas individuais: duas abas não sobrescrevem o mesmo array. */
export function createLocalJornadaAttemptStore(storage: StorageLike) {
  return {
    list(uid: string): JornadaAttempt[] {
      if (!uid) return [];
      const prefix = `${PREFIX}${encodeURIComponent(uid)}:`;
      const attempts: JornadaAttempt[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const itemKey = storage.key(index);
        if (!itemKey?.startsWith(prefix)) continue;
        const raw = storage.getItem(itemKey);
        if (!raw) continue;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (validAttempt(parsed, uid) && itemKey === key(uid, parsed.pendingCreateId)) {
            attempts.push(parsed);
          }
        } catch { /* registro inválido fica intacto para recuperação manual */ }
      }
      return attempts;
    },
    put(attempt: JornadaAttempt): void {
      if (!validAttempt(attempt, attempt.pendingUid)) throw new Error('Tentativa da jornada inválida.');
      storage.setItem(key(attempt.pendingUid, attempt.pendingCreateId), JSON.stringify(attempt));
    },
    remove(uid: string, id: string): void {
      storage.removeItem(key(uid, id));
    },
  };
}
