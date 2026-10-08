import { describe, expect, it, vi } from 'vitest';
import { createManualConsumptionManager, type ManualConsumptionAttempt } from './manual-consumption-attempt';
import { createLocalManualConsumptionStore } from '../infrastructure/local-manual-consumption-store';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('tentativa durável de consumo manual', () => {
  it('persiste ID, UID e payload antes do envio e reutiliza após recarga/resposta perdida', async () => {
    const storage = memoryStorage();
    const applied: ManualConsumptionAttempt[] = [];
    let loseResponse = true;
    const gateway = { apply: vi.fn(async (attempt: ManualConsumptionAttempt) => {
      applied.push(attempt);
      if (loseResponse) throw new Error('resposta perdida');
      return attempt.consumption;
    }) };
    const first = createManualConsumptionManager(createLocalManualConsumptionStore(storage), gateway, () => 'id-1');
    const attempt = first.prepare('uid-A', 39);
    expect(attempt).toEqual({ id: 'id-1', uid: 'uid-A', consumption: 39 });
    await expect(first.retry('uid-A')).rejects.toThrow('resposta perdida');

    loseResponse = false;
    const reloaded = createManualConsumptionManager(createLocalManualConsumptionStore(storage), gateway, () => 'wrong-new-id');
    expect(reloaded.get('uid-A')).toEqual(attempt);
    await expect(reloaded.retry('uid-A')).resolves.toBe(39);
    expect(applied).toEqual([attempt, attempt]);
    expect(reloaded.get('uid-A')).toBeNull();
  });

  it('compartilha retry simultâneo e não permite substituir o payload pendente', async () => {
    const store = createLocalManualConsumptionStore(memoryStorage());
    let complete!: (value: number) => void;
    const gateway = { apply: vi.fn(() => new Promise<number>((resolve) => { complete = resolve; })) };
    const manager = createManualConsumptionManager(store, gateway, () => 'id-2');
    manager.prepare('uid-A', 38);
    expect(() => manager.prepare('uid-A', 41)).toThrow('Confirme primeiro');
    const a = manager.retry('uid-A');
    const b = manager.retry('uid-A');
    expect(a).toBe(b);
    await Promise.resolve();
    expect(gateway.apply).toHaveBeenCalledTimes(1);
    complete(38);
    await expect(a).resolves.toBe(38);
  });

  it('isola por UID e preserva a tentativa de A durante troca de usuário', async () => {
    const store = createLocalManualConsumptionStore(memoryStorage());
    const manager = createManualConsumptionManager(store, { apply: async (attempt) => attempt.consumption }, () => 'id-3');
    manager.prepare('uid-A', 39);
    expect(manager.get('uid-B')).toBeNull();
    await expect(manager.retry('uid-B')).rejects.toThrow('Não há consumo');
    expect(manager.get('uid-A')?.consumption).toBe(39);
  });

  it('não envia se o armazenamento local falha', () => {
    const gateway = { apply: vi.fn(async () => 39) };
    const store = createLocalManualConsumptionStore({
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    });
    const manager = createManualConsumptionManager(store, gateway, () => 'id-4');
    expect(() => manager.prepare('uid-A', 39)).toThrow('quota');
    expect(gateway.apply).not.toHaveBeenCalled();
  });
});
