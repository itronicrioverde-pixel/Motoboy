import { describe, expect, it } from 'vitest';
import { createLocalJornadaAttemptStore, type JornadaAttempt } from './local-jornada-attempt-store';
import { isolateLocalCache } from '../../auth/application/local-cache-isolation';

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

const attempt: JornadaAttempt = {
  pendingCreateId: 'attempt_1', pendingUid: 'uid-a', fsId: null,
  status: 'open', kmInicial: 3000, dataInicioISO: '2026-10-01',
  horaInicioISO: '08:01', syncState: 'pending',
};

describe('tentativa local da jornada por UID', () => {
  it('sobrevive à recarga e à troca de conta sem expor o outro dono', () => {
    const storage = new MemoryStorage();
    createLocalJornadaAttemptStore(storage).put(attempt);
    const reloaded = createLocalJornadaAttemptStore(storage);
    expect(reloaded.list('uid-b')).toEqual([]);
    expect(reloaded.list('uid-a')).toEqual([attempt]);
    reloaded.remove('uid-a', attempt.pendingCreateId);
    expect(reloaded.list('uid-a')).toEqual([]);
  });

  it('preserva tentativas de abas diferentes em chaves independentes', () => {
    const storage = new MemoryStorage();
    const first = createLocalJornadaAttemptStore(storage);
    const second = createLocalJornadaAttemptStore(storage);
    first.put(attempt);
    second.put({ ...attempt, pendingCreateId: 'attempt_2', kmInicial: 3001 });
    expect(first.list('uid-a').map((item) => item.pendingCreateId).sort())
      .toEqual(['attempt_1', 'attempt_2']);
  });

  it('continua disponível quando o isolamento limpa o cache agregado na troca de UID', () => {
    const storage = new MemoryStorage();
    storage.setItem('owner', 'uid-a');
    storage.setItem('panel-cache', JSON.stringify({ jornadas: [attempt] }));
    const store = createLocalJornadaAttemptStore(storage);
    store.put(attempt);
    expect(isolateLocalCache('uid-b', storage, 'owner', ['panel-cache']).reload).toBe(true);
    expect(storage.getItem('panel-cache')).toBeNull();
    expect(store.list('uid-b')).toEqual([]);
    expect(isolateLocalCache('uid-a', storage, 'owner', ['panel-cache']).reload).toBe(true);
    expect(createLocalJornadaAttemptStore(storage).list('uid-a')).toEqual([attempt]);
  });
});
