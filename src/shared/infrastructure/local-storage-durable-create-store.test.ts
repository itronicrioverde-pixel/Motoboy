import { describe, expect, it } from 'vitest';
import {
  createLocalStorageDurableCreateStore,
  durableCreateAttemptStorageKey,
  durableCreateStorageKey,
  type DurableCreateStorage,
} from './local-storage-durable-create-store';
import type { DurableCreateAttempt } from '../application/durable-create-manager';

function attempt(uid: string, id: string): DurableCreateAttempt {
  return {
    uid, id, kind: 'entradas',
    payload: {
      createAttemptId: id, createdAt: 1234, updatedAt: 1234,
      edited: false, editReason: null, desc: 'Entrada', valor: 25, dateISO: '2026-09-29',
    },
  };
}

function storage(): DurableCreateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('local storage durable create store', () => {
  it('preserva tentativas separadas por UID e limpa só a operação confirmada', () => {
    const backend = storage();
    const store = createLocalStorageDurableCreateStore(backend);
    store.save(attempt('uid-A', 'id-1'));
    store.save(attempt('uid-A', 'id-2'));
    store.save(attempt('uid-B', 'id-3'));
    expect(store.list('uid-A').map((item) => item.id)).toEqual(['id-1', 'id-2']);
    expect(store.list('uid-B').map((item) => item.id)).toEqual(['id-3']);
    store.clear('uid-A', 'entradas', 'id-1');
    expect(store.list('uid-A').map((item) => item.id)).toEqual(['id-2']);
    expect(store.list('uid-B').map((item) => item.id)).toEqual(['id-3']);
  });

  it('não troca payload de uma tentativa já persistida', () => {
    const backend = storage();
    const store = createLocalStorageDurableCreateStore(backend);
    const original = attempt('uid-A', 'id-1');
    store.save(original);
    store.save(original);
    expect(() => store.save({ ...original, payload: { ...original.payload, valor: 40 } })).toThrow('payload diferente');
    expect(store.list('uid-A')).toEqual([original]);
  });

  it('duas abas não podem perder uma tentativa quando leem o mesmo snapshot antigo', () => {
    const backend = storage();
    const storeA = createLocalStorageDurableCreateStore(backend);
    const storeB = createLocalStorageDurableCreateStore(backend);
    const originalGet = backend.getItem;
    let interleaved = false;
    backend.getItem = (key) => {
      const value = originalGet(key);
      if (!interleaved && key === durableCreateStorageKey('uid-A')) {
        interleaved = true;
        storeB.save(attempt('uid-A', 'id-b'));
      }
      return value;
    };
    storeA.save(attempt('uid-A', 'id-a'));
    expect(storeA.list('uid-A').map((item) => item.id).sort()).toEqual(['id-a', 'id-b']);
  });

  it('JSON corrompido é mantido sem sobrescrever; leitura não vaza para outro UID', () => {
    const backend = storage();
    const key = durableCreateStorageKey('uid-A');
    backend.setItem(key, '{incompleto');
    const store = createLocalStorageDurableCreateStore(backend);
    expect(() => store.list('uid-A')).toThrow('corrompidas');
    expect(store.list('uid-B')).toEqual([]);
    expect(() => store.save(attempt('uid-A', 'id-1'))).toThrow('corrompidas');
    expect(backend.getItem(key)).toBe('{incompleto');
  });

  it('falha se setItem não preservou os bytes antes de autorizar envio remoto', () => {
    const backend = storage();
    backend.setItem = () => {};
    const store = createLocalStorageDurableCreateStore(backend);
    expect(() => store.save(attempt('uid-A', 'id-1'))).toThrow('não permaneceu gravada');
  });

  it('não anuncia limpeza se a remoção local falhar após o commit', () => {
    const backend = storage();
    const store = createLocalStorageDurableCreateStore(backend);
    store.save(attempt('uid-A', 'id-1'));
    backend.setItem = () => {};
    expect(() => store.clear('uid-A', 'entradas', 'id-1')).toThrow('não foi removida');
    expect(store.list('uid-A')).toHaveLength(1);
  });

  it('lê tentativa V1 sem alterá-la e tombstone V2 impede retorno após recarga', () => {
    const backend = storage();
    const legacy = attempt('uid-A', 'id-legado');
    const legacyKey = durableCreateStorageKey('uid-A');
    const original = JSON.stringify([legacy]);
    backend.setItem(legacyKey, original);
    const first = createLocalStorageDurableCreateStore(backend);
    expect(first.list('uid-A')).toEqual([legacy]);
    first.save(attempt('uid-A', 'id-novo'));
    expect(first.list('uid-A').map((item) => item.id)).toEqual(['id-legado', 'id-novo']);
    first.clear('uid-A', 'entradas', 'id-legado');
    const reloaded = createLocalStorageDurableCreateStore(backend);
    expect(reloaded.list('uid-A').map((item) => item.id)).toEqual(['id-novo']);
    expect(backend.getItem(legacyKey)).toBe(original);
    expect(() => reloaded.save(legacy)).toThrow('já foi confirmado');
  });

  it('isola UIDs com pontos nos nomes', () => {
    const backend = storage();
    const store = createLocalStorageDurableCreateStore(backend);
    store.save(attempt('uid-A.extra', 'id-1'));
    expect(store.list('uid-A')).toEqual([]);
    expect(store.list('uid-A.extra')).toHaveLength(1);
    expect(durableCreateAttemptStorageKey('uid-A', 'entradas', 'id-1'))
      .not.toBe(durableCreateAttemptStorageKey('uid-A.extra', 'entradas', 'id-1'));
  });

  it('não sobrescreve uma tentativa V2 corrompida', () => {
    const backend = storage();
    const key = durableCreateAttemptStorageKey('uid-A', 'entradas', 'id-1');
    backend.setItem(key, '{incompleto');
    const store = createLocalStorageDurableCreateStore(backend);
    expect(() => store.list('uid-A')).toThrow('corrompidas');
    expect(() => store.save(attempt('uid-A', 'id-2'))).toThrow('corrompidas');
    expect(backend.getItem(key)).toBe('{incompleto');
  });
});
