import { deleteApp, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, setDoc, terminate } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createManualConsumptionManager, type ManualConsumptionAttempt } from '../application/manual-consumption-attempt';
import { createLocalManualConsumptionStore } from './local-manual-consumption-store';

const uid = 'moto-manual-user';
let app: FirebaseApp;
let db: Firestore;
let apply: typeof import('./firestore-manual-consumption-gateway').firestoreManualConsumptionGateway.apply;
let telemetry: typeof import('./moto-transaction-writer').persistMotoTelemetrySnapshot;

beforeAll(async () => {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error('FIRESTORE_EMULATOR_HOST obrigatório.');
  const [host, rawPort] = address.split(':');
  const projectId = process.env.GCLOUD_PROJECT ?? 'demo-motoboy';
  if (!projectId.startsWith('demo-')) throw new Error('Use somente projeto demo-* no Emulator.');
  app = initializeApp({ projectId }, 'moto-manual-emulator');
  db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(rawPort), { mockUserToken: { sub: uid } });
  vi.doMock('../../../config/firebase.js', () => ({ db }));
  ({ firestoreManualConsumptionGateway: { apply } } = await import('./firestore-manual-consumption-gateway'));
  ({ persistMotoTelemetrySnapshot: telemetry } = await import('./moto-transaction-writer'));
});

afterAll(async () => {
  vi.doUnmock('../../../config/firebase.js');
  if (db) await terminate(db);
  if (app) await deleteApp(app);
});

describe('consumo manual no Firestore Emulator', () => {
  it('confirma documento e marcador atomicamente; retry após resposta perdida não reaplica valor antigo', async () => {
    const ref = doc(db, 'users', uid, 'moto', 'data');
    await setDoc(ref, { currentKm: 1000, consumption: 35, consumptionIsManual: true });
    const first: ManualConsumptionAttempt = { id: 'manual-first', uid, consumption: 39 };
    expect(await apply(first)).toMatchObject({ currentKm: 1000, consumption: 39, consumptionIsManual: true });
    expect((await getDocFromServer(doc(db, 'users', uid, 'motoConsumptionAttempts', first.id))).data())
      .toMatchObject({ uid, consumption: 39 });
    const second: ManualConsumptionAttempt = { id: 'manual-second', uid, consumption: 41 };
    await apply(second);
    expect(await apply(first)).toMatchObject({ consumption: 41 });
    expect((await getDocFromServer(ref)).data()).toMatchObject({ consumption: 41 });
  });

  it('telemetria atrasada preserva consumo manual e avança somente o hodômetro', async () => {
    const ref = doc(db, 'users', uid, 'moto', 'data');
    await telemetry(ref, { currentKm: 1500, consumption: 20, consumptionIsManual: false });
    expect((await getDocFromServer(ref)).data()).toMatchObject({ currentKm: 1500, consumption: 41, consumptionIsManual: true });
  });

  it('rejeita colisão do marcador sem alterar a moto', async () => {
    await expect(apply({ id: 'manual-first', uid, consumption: 99 })).rejects.toThrow('outros dados');
    expect((await getDocFromServer(doc(db, 'users', uid, 'moto', 'data'))).data())
      .toMatchObject({ consumption: 41 });
  });

  it('retoma após recarga e resposta perdida sem reaplicar consumo antigo', async () => {
    const motoRef = doc(db, 'users', uid, 'moto', 'data');
    await setDoc(motoRef, { currentKm: 1500, consumption: 35, consumptionIsManual: true });
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const first = createManualConsumptionManager(
      createLocalManualConsumptionStore(storage),
      { apply: async (attempt: ManualConsumptionAttempt) => {
        await apply(attempt);
        throw new Error('Resposta perdida depois do commit');
      } },
      () => 'manual-lost-response',
    );
    const attempt = first.prepare(uid, 39);
    await expect(first.retry(uid)).rejects.toThrow('Resposta perdida');
    expect(first.get(uid)).toEqual(attempt);
    expect((await getDocFromServer(motoRef)).data()).toMatchObject({ consumption: 39 });

    await apply({ id: 'manual-newer', uid, consumption: 41 });
    const afterReload = createManualConsumptionManager(
      createLocalManualConsumptionStore(storage),
      { apply },
      () => 'unused-new-id',
    );
    expect(afterReload.get(uid)).toEqual(attempt);
    await expect(afterReload.retry(uid)).resolves.toMatchObject({ consumption: 41 });
    expect(afterReload.get(uid)).toBeNull();
    expect((await getDocFromServer(motoRef)).data()).toMatchObject({ consumption: 41 });
    expect((await getDocFromServer(doc(db, 'users', uid, 'motoConsumptionAttempts', attempt.id))).data())
      .toMatchObject({ uid, consumption: 39 });
  });
});
