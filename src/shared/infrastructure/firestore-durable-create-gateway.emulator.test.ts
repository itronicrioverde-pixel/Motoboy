import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, doc,
  getDocFromServer, getFirestore, setDoc, terminate, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDurableCreateManager, type DurableCreateAttempt, type DurableCreateKind } from '../application/durable-create-manager';
import { createLocalStorageDurableCreateStore } from './local-storage-durable-create-store';
import { FirestoreDurableCreateGateway } from './firestore-durable-create-gateway';

const uid = 'durable-create-owner';
let app: FirebaseApp;
let db: Firestore;
let gateway: FirestoreDurableCreateGateway;

function createAttempt(kind: DurableCreateKind, id = crypto.randomUUID(), owner = uid): DurableCreateAttempt {
  const createdAt = 1234567890;
  const common = { createAttemptId: id, createdAt, updatedAt: createdAt, edited: false, editReason: null };
  const payload = kind === 'abastecimentos'
    ? { ...common, dateISO: '2026-09-29', location: 'Posto beta', paidValue: 100, pricePerLiter: 5, liters: 20, odometer: 1200 }
    : kind === 'manutencoes'
      ? { ...common, category: 'maintenance', desc: 'Óleo', valor: 50, km: 1200, dateISO: '2026-09-29' }
      : { ...common, desc: 'Entrega avulsa', valor: 80, dateISO: '2026-09-29' };
  return { uid: owner, kind, id, payload };
}

beforeAll(() => {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error('FIRESTORE_EMULATOR_HOST obrigatório.');
  const [host, rawPort] = address.split(':');
  const port = Number(rawPort);
  if (!host || !Number.isInteger(port) || port <= 0) throw new Error('Endereço do Emulator inválido.');
  const projectId = process.env.GCLOUD_PROJECT ?? 'demo-motoboy';
  if (!projectId.startsWith('demo-')) throw new Error('Use somente projeto demo-* no Emulator.');
  app = initializeApp({ projectId }, 'durable-create-emulator');
  db = getFirestore(app);
  connectFirestoreEmulator(db, host, port, { mockUserToken: { sub: uid } });
  gateway = new FirestoreDurableCreateGateway(db, () => uid);
});

afterAll(async () => {
  if (db) await terminate(db);
  if (app) await deleteApp(app);
});

describe('criação durável no Firestore Emulator', () => {
  it.each(['abastecimentos', 'manutencoes', 'entradas'] as const)('%s: retry escreve uma vez e preserva payload', async (kind) => {
    const attempt = createAttempt(kind);
    expect(await gateway.commit(attempt)).toBe('created');
    expect(await gateway.commit(attempt)).toBe('already-applied');
    const target = doc(db, 'users', uid, kind, attempt.id);
    const marker = doc(db, 'users', uid, 'createAttempts', `${kind}_${attempt.id}`);
    expect((await getDocFromServer(target)).data()).toEqual(attempt.payload);
    expect((await getDocFromServer(marker)).data()?.payloadJson).toBe(JSON.stringify(attempt.payload));
  });

  it('resposta perdida + recarga usa exatamente o mesmo ID, UID e payload', async () => {
    const raw = new Map<string, string>();
    const store = createLocalStorageDurableCreateStore({
      get length() { return raw.size; },
      key: (index) => [...raw.keys()][index] ?? null,
      getItem: (key) => raw.get(key) ?? null,
      setItem: (key, value) => { raw.set(key, value); },
      removeItem: (key) => { raw.delete(key); },
    });
    const firstGateway = {
      commit: vi.fn(async (attempt: DurableCreateAttempt) => {
        await gateway.commit(attempt);
        throw new Error('resposta perdida após commit');
      }),
    };
    const id = crypto.randomUUID();
    const deps = { currentUid: () => uid, generateId: () => id, now: () => 1234567890, store };
    const first = createDurableCreateManager({ ...deps, gateway: firstGateway });
    const attempt = first.prepare('entradas', (createdId, timestamp) => ({
      createAttemptId: createdId, createdAt: timestamp, updatedAt: timestamp,
      edited: false, editReason: null, desc: 'Resposta perdida', valor: 33, dateISO: '2026-09-29',
    }));
    await expect(first.retry('entradas', id)).rejects.toThrow('resposta perdida');
    const reloaded = createDurableCreateManager({ ...deps, generateId: () => crypto.randomUUID(), gateway });
    expect(reloaded.pending('entradas')).toEqual([attempt]);
    expect(await reloaded.retry('entradas', id)).toBe('already-applied');
    expect(reloaded.pending('entradas')).toEqual([]);
    expect((await getDocFromServer(doc(db, 'users', uid, 'entradas', id))).data()).toEqual(attempt.payload);
  });

  it('retries simultâneos não duplicam o documento nem o marcador', async () => {
    const attempt = createAttempt('manutencoes');
    const results = await Promise.all([gateway.commit(attempt), gateway.commit(attempt)]);
    expect(results.sort()).toEqual(['already-applied', 'created']);
    expect((await getDocFromServer(doc(db, 'users', uid, 'manutencoes', attempt.id))).exists()).toBe(true);
  });

  it('não sobrescreve registro preexistente nem ressuscita um removido após commit', async () => {
    const collision = createAttempt('entradas');
    const target = doc(db, 'users', uid, 'entradas', collision.id);
    await setDoc(target, { desc: 'legado', valor: 9 });
    await expect(gateway.commit(collision)).rejects.toThrow('outro registro');
    expect((await getDocFromServer(target)).data()?.desc).toBe('legado');

    const attempt = createAttempt('entradas');
    await gateway.commit(attempt);
    await deleteDoc(doc(db, 'users', uid, 'entradas', attempt.id));
    expect(await gateway.commit(attempt)).toBe('removed');
    expect((await getDocFromServer(doc(db, 'users', uid, 'entradas', attempt.id))).exists()).toBe(false);
  });

  it('rejeita payload alterado e UID de outra conta', async () => {
    const attempt = createAttempt('abastecimentos');
    await gateway.commit(attempt);
    await expect(gateway.commit({ ...attempt, payload: { ...attempt.payload, paidValue: 200 } }))
      .rejects.toThrow('payload diferente');
    await expect(gateway.commit(createAttempt('abastecimentos', crypto.randomUUID(), 'outro-uid')))
      .rejects.toThrow('outro usuário');
  });

  it('falha de conexão injetada preserva a tentativa; reconexão confirma no Emulator', async () => {
    const attempt = createAttempt('abastecimentos');
    const raw = new Map<string, string>();
    const store = createLocalStorageDurableCreateStore({
      get length() { return raw.size; },
      key: (index) => [...raw.keys()][index] ?? null,
      getItem: (key) => raw.get(key) ?? null,
      setItem: (key, value) => { raw.set(key, value); },
      removeItem: (key) => { raw.delete(key); },
    });
    store.save(attempt);
    const offlineGateway = { commit: vi.fn(async () => { throw new Error('unavailable'); }) };
    const deps = { currentUid: () => uid, generateId: () => attempt.id, now: () => 1234567890, store };
    const offline = createDurableCreateManager({ ...deps, gateway: offlineGateway });
    await expect(offline.retry('abastecimentos', attempt.id)).rejects.toThrow('unavailable');
    expect(offline.pending('abastecimentos')).toEqual([attempt]);
    const reconnected = createDurableCreateManager({ ...deps, gateway });
    expect(await reconnected.retry('abastecimentos', attempt.id)).toBe('created');
    expect(reconnected.pending('abastecimentos')).toEqual([]);
    expect((await getDocFromServer(doc(db, 'users', uid, 'abastecimentos', attempt.id))).data()).toEqual(attempt.payload);
  });
});
