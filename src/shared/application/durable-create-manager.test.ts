import { describe, expect, it, vi } from 'vitest';
import {
  createDurableCreateManager,
  isDurableCreateAttempt,
  type DurableCreateAttempt,
  type DurableCreateGateway,
  type DurableCreateStore,
} from './durable-create-manager';

function refuelPayload(id: string, createdAt: number) {
  return {
    createAttemptId: id, createdAt, updatedAt: createdAt, edited: false, editReason: null,
    dateISO: '2026-09-29', location: 'Posto A', paidValue: 100,
    pricePerLiter: 5, liters: 20, odometer: 1200,
  };
}

function memoryStore(): DurableCreateStore & { attempts: DurableCreateAttempt[] } {
  const attempts: DurableCreateAttempt[] = [];
  return {
    attempts,
    list: (uid) => attempts.filter((attempt) => attempt.uid === uid).map((attempt) => structuredClone(attempt)),
    save: (attempt) => { attempts.push(structuredClone(attempt)); },
    clear: (uid, kind, id) => {
      const index = attempts.findIndex((attempt) => attempt.uid === uid && attempt.kind === kind && attempt.id === id);
      if (index >= 0) attempts.splice(index, 1);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('durable create manager', () => {
  it('guarda UID, ID e payload antes do gateway e reutiliza tudo após resposta perdida e recarga', async () => {
    const store = memoryStore();
    let committed: DurableCreateAttempt | null = null;
    const gateway: DurableCreateGateway = {
      commit: vi.fn(async (attempt) => {
        expect(store.attempts).toEqual([attempt]);
        if (!committed) {
          committed = structuredClone(attempt);
          throw new Error('resposta perdida');
        }
        expect(attempt).toEqual(committed);
        return 'already-applied' as const;
      }),
    };
    const deps = { currentUid: () => 'uid-A', generateId: () => 'id-1', now: () => 1234, store, gateway };
    const first = createDurableCreateManager(deps);
    const attempt = first.prepare('abastecimentos', refuelPayload);
    expect(attempt).toMatchObject({ uid: 'uid-A', id: 'id-1', payload: refuelPayload('id-1', 1234) });
    await expect(first.retry('abastecimentos', attempt.id)).rejects.toThrow('resposta perdida');

    const afterReload = createDurableCreateManager({ ...deps, generateId: () => 'id-NEVER' });
    expect(afterReload.pending('abastecimentos')).toEqual([attempt]);
    await expect(afterReload.retry('abastecimentos', attempt.id)).resolves.toBe('already-applied');
    expect(store.attempts).toEqual([]);
    expect(gateway.commit).toHaveBeenCalledTimes(2);
  });

  it('dois retries simultâneos compartilham uma única chamada e um resultado', async () => {
    const store = memoryStore();
    const waiting = deferred<'created'>();
    const gateway = { commit: vi.fn(() => waiting.promise) };
    const manager = createDurableCreateManager({ currentUid: () => 'uid-A', generateId: () => 'id-2', now: () => 1234, store, gateway });
    manager.prepare('abastecimentos', refuelPayload);
    const first = manager.retry('abastecimentos', 'id-2');
    const second = manager.retry('abastecimentos', 'id-2');
    expect(second).toBe(first);
    await Promise.resolve();
    expect(gateway.commit).toHaveBeenCalledTimes(1);
    waiting.resolve('created');
    await expect(Promise.all([first, second])).resolves.toEqual(['created', 'created']);
    expect(store.attempts).toEqual([]);
  });

  it('troca de UID não aplica sucesso nem limpa a tentativa do dono anterior', async () => {
    const store = memoryStore();
    const waiting = deferred<'created'>();
    let uid = 'uid-A';
    const manager = createDurableCreateManager({ currentUid: () => uid, generateId: () => 'id-3', now: () => 1234, store, gateway: { commit: () => waiting.promise } });
    manager.prepare('abastecimentos', refuelPayload);
    const result = manager.retry('abastecimentos', 'id-3');
    uid = 'uid-B';
    expect(manager.pending('abastecimentos')).toEqual([]);
    waiting.resolve('created');
    await expect(result).rejects.toThrow('Sessão alterada');
    expect(store.attempts).toHaveLength(1);
    await expect(manager.retry('abastecimentos', 'id-3')).rejects.toThrow('não encontrada');
    uid = 'uid-A';
    expect(manager.pending('abastecimentos')).toHaveLength(1);
  });

  it('falha do storage impede qualquer envio ao servidor', () => {
    const store = memoryStore();
    store.save = () => { throw new Error('quota'); };
    const gateway = { commit: vi.fn() };
    const manager = createDurableCreateManager({ currentUid: () => 'uid-A', generateId: () => 'id-4', now: () => 1234, store, gateway });
    expect(() => manager.prepare('abastecimentos', refuelPayload)).toThrow('quota');
    expect(gateway.commit).not.toHaveBeenCalled();
  });

  it('rejeita payload editado, incompleto ou com campos extras no storage', () => {
    const valid = { uid: 'uid-A', kind: 'abastecimentos', id: 'id-5', payload: refuelPayload('id-5', 1234) };
    expect(isDurableCreateAttempt(valid)).toBe(true);
    expect(isDurableCreateAttempt({ ...valid, payload: { ...valid.payload, paidValue: 0 } })).toBe(false);
    expect(isDurableCreateAttempt({ ...valid, payload: { ...valid.payload, extra: 'não permitido' } })).toBe(false);
    expect(isDurableCreateAttempt({ ...valid, payload: { ...valid.payload, createAttemptId: 'outro' } })).toBe(false);
  });
});
