import { deleteApp, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
  terminate,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const uid = 'beta-repositories-user';
let app: FirebaseApp;
let db: Firestore;
let Refuels: typeof import('../../features/abastecimentos/infrastructure/firestore-abastecimento-repository').FirestoreAbastecimentoRepository;
let Maintenance: typeof import('../../features/manutencoes/infrastructure/firestore-manutencao-repository').FirestoreManutencaoRepository;
let Entries: typeof import('../../features/faturamento/infrastructure/firestore-entrada-repository').FirestoreEntradaRepository;
let Moto: typeof import('../../features/moto/infrastructure/firestore-moto-repository').FirestoreMotoRepository;

beforeAll(async () => {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error('FIRESTORE_EMULATOR_HOST obrigatório.');
  const [host, rawPort] = address.split(':');
  const port = Number(rawPort);
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new Error(`FIRESTORE_EMULATOR_HOST inválido: ${address}`);
  }
  const projectId = process.env.GCLOUD_PROJECT ?? 'demo-motoboy';
  if (!projectId.startsWith('demo-')) throw new Error('Use somente projeto demo-* no Emulator.');

  app = initializeApp({ projectId }, 'beta-repositories-emulator');
  db = getFirestore(app);
  connectFirestoreEmulator(db, host, port, { mockUserToken: { sub: uid } });
  vi.doMock('../../config/firebase.js', () => ({ db }));
  ({ FirestoreAbastecimentoRepository: Refuels } = await import('../../features/abastecimentos/infrastructure/firestore-abastecimento-repository'));
  ({ FirestoreManutencaoRepository: Maintenance } = await import('../../features/manutencoes/infrastructure/firestore-manutencao-repository'));
  ({ FirestoreEntradaRepository: Entries } = await import('../../features/faturamento/infrastructure/firestore-entrada-repository'));
  ({ FirestoreMotoRepository: Moto } = await import('../../features/moto/infrastructure/firestore-moto-repository'));
});

afterAll(async () => {
  vi.doUnmock('../../config/firebase.js');
  if (db) await terminate(db);
  if (app) await deleteApp(app);
});

describe('repositórios do beta no Firestore Emulator', () => {
  it('abastecimento grava, recalcula litros na edição e reaparece na leitura', async () => {
    const repo = new Refuels(() => uid);
    const created = await repo.add({
      dateISO: '2026-09-28', location: 'Posto teste', paidValue: 100,
      pricePerLiter: 5, odometer: 1200,
    });
    expect(created.liters).toBe(20);
    expect((await getDocFromServer(doc(db, 'users', uid, 'abastecimentos', created.id))).exists()).toBe(true);
    await repo.update(created.id, { paidValue: 120, pricePerLiter: 6, editReason: 'Correção do valor' });
    expect(await new Refuels(() => uid).list()).toEqual([
      expect.objectContaining({
        id: created.id, paidValue: 120, pricePerLiter: 6, liters: 20,
        edited: true, editReason: 'Correção do valor',
      }),
    ]);
  });

  it('manutenção grava, edita e reaparece na leitura', async () => {
    const repo = new Maintenance(() => uid);
    const created = await repo.add({
      category: 'maintenance', desc: 'Troca de óleo', valor: 50,
      km: 1200, dateISO: '2026-09-28',
    });
    await repo.update(created.id, { valor: 55, editReason: 'Valor corrigido' });
    expect(await new Maintenance(() => uid).list()).toEqual([
      expect.objectContaining({
        id: created.id, desc: 'Troca de óleo', valor: 55, km: 1200,
        edited: true, editReason: 'Valor corrigido',
      }),
    ]);
  });

  it('entrada manual grava e edita sem ganhar identidade de recebimento', async () => {
    const repo = new Entries(() => uid);
    const created = await repo.add({ desc: 'Serviço avulso', valor: 80, dateISO: '2026-09-28' });
    await repo.update(created.id, { valor: 90, editReason: 'Valor corrigido' });
    expect(await new Entries(() => uid).list()).toEqual([
      expect.objectContaining({
        id: created.id, desc: 'Serviço avulso', valor: 90,
        edited: true, editReason: 'Valor corrigido',
      }),
    ]);
    const persisted = (await getDocFromServer(doc(db, 'users', uid, 'entradas', created.id))).data();
    expect(persisted).not.toHaveProperty('receiptOperationId');
    expect(persisted).not.toHaveProperty('source');
  });

  it('moto salva hodômetro e consumo e uma nova instância relê do servidor', async () => {
    const repo = new Moto(() => uid);
    await repo.save({ currentKm: 1200, consumption: 25, consumptionIsManual: true });
    expect(await new Moto(() => uid).get()).toEqual({
      currentKm: 1200, consumption: 25, consumptionIsManual: true,
    });
    expect((await getDocFromServer(doc(db, 'users', uid, 'moto', 'data'))).data()).toMatchObject({
      currentKm: 1200, consumption: 25, consumptionIsManual: true,
    });
  });

  it('snapshot atrasado não reduz o hodômetro remoto da moto', async () => {
    const firstDevice = new Moto(() => uid);
    const secondDevice = new Moto(() => uid);
    await firstDevice.save({ currentKm: 2000, consumption: 25, consumptionIsManual: true });
    await secondDevice.save({ currentKm: 1500, consumption: 26, consumptionIsManual: true });

    const persisted = (await getDocFromServer(doc(db, 'users', uid, 'moto', 'data'))).data();
    expect(persisted).toMatchObject({
      currentKm: 2000,
      consumption: 26,
      consumptionIsManual: true,
    });
  });
});
