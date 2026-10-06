import { deleteApp, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  setDoc,
  terminate,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JornadaService } from '../application/jornada-service';

const uid = 'beta-jornada-user';
let app: FirebaseApp;
let db: Firestore;
let FirestoreJornadaRepository: typeof import('./firestore-jornada-repository').FirestoreJornadaRepository;

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

  app = initializeApp({ projectId }, 'jornada-repository-emulator');
  db = getFirestore(app);
  connectFirestoreEmulator(db, host, port, { mockUserToken: { sub: uid } });
  vi.doMock('../../../config/firebase.js', () => ({ db }));
  ({ FirestoreJornadaRepository } = await import('./firestore-jornada-repository'));
});

afterAll(async () => {
  vi.doUnmock('../../../config/firebase.js');
  if (db) await terminate(db);
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  // Apenas fixtures deste UID em um projeto demo-* isolado.
  const existing = await getDocsFromServer(collection(db, 'users', uid, 'jornadas'));
  await Promise.all(existing.docs.map((snapshot) => deleteDoc(snapshot.ref)));
  await deleteDoc(doc(db, 'users', uid, 'jornadaState', 'current'));
});

describe('Jornada no Firestore Emulator', () => {
  it('não permite duas aberturas simultâneas com leituras diferentes', async () => {
    let observed = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    class BarrierRepository extends FirestoreJornadaRepository {
      override async findOpen() {
        const open = await super.findOpen();
        observed += 1;
        if (observed === 2) release();
        await bothRead;
        return open;
      }
    }
    const first = new JornadaService(new BarrierRepository(() => uid));
    const second = new JornadaService(new BarrierRepository(() => uid));
    const results = await Promise.allSettled([
      first.start({ kmInicial: 1200, dataInicioISO: '2026-09-29', horaInicioISO: '08:00' }),
      second.start({ kmInicial: 1201, dataInicioISO: '2026-09-29', horaInicioISO: '08:01' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const open = (await new FirestoreJornadaRepository(() => uid).list())
      .filter((jornada) => jornada.status === 'open');
    expect(open).toHaveLength(1);
    expect((await getDocFromServer(doc(db, 'users', uid, 'jornadaState', 'current'))).data()?.activeJornadaId)
      .toBe(open[0].id);
  });

  it('persiste abertura e fechamento, preserva histórico e não lança o custo em faturamento', async () => {
    const firstSession = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const opened = await firstSession.start({
      kmInicial: 1000,
      dataInicioISO: '2026-09-28',
      horaInicioISO: '08:00',
    });
    expect(opened.status).toBe('open');
    expect((await getDocFromServer(doc(db, 'users', uid, 'jornadas', opened.id))).exists()).toBe(true);

    // Uma nova instância lê exclusivamente o Firestore, como na reidratação.
    const secondSession = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const reloaded = await secondSession.list();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({ id: opened.id, status: 'open', kmInicial: 1000 });

    const closed = await secondSession.close(opened.id, {
      kmFinal: 1100,
      dataFimISO: '2026-09-28',
      horaFimISO: '18:00',
      consumoReferencia: 25,
      origemConsumo: 'manual',
      precoReferencia: 6,
      origemPreco: 'manual',
    });
    expect(closed).toMatchObject({ status: 'closed', kmFinal: 1100, custoEstimado: 24 });

    const finalHistory = await new JornadaService(new FirestoreJornadaRepository(() => uid)).list();
    expect(finalHistory).toHaveLength(1);
    expect(finalHistory[0]).toMatchObject({
      id: opened.id,
      status: 'closed',
      dataFimISO: '2026-09-28',
      horaFimISO: '18:00',
      custoEstimado: 24,
    });
    expect((await getDocsFromServer(collection(db, 'users', uid, 'entradas'))).empty).toBe(true);
  });

  it('fechamentos simultâneos retornam o mesmo registro persistido', async () => {
    const initial = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const opened = await initial.start({
      kmInicial: 1200,
      dataInicioISO: '2026-09-29',
      horaInicioISO: '08:00',
    });
    let observed = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    class BarrierRepository extends FirestoreJornadaRepository {
      override async list() {
        const jornadas = await super.list();
        observed += 1;
        if (observed === 2) release();
        await bothRead;
        return jornadas;
      }
    }
    const first = new JornadaService(new BarrierRepository(() => uid));
    const second = new JornadaService(new BarrierRepository(() => uid));
    const [resultA, resultB] = await Promise.all([
      first.close(opened.id, {
        kmFinal: 1300, dataFimISO: '2026-09-29', horaFimISO: '17:00',
        consumoReferencia: 25, precoReferencia: 6,
      }),
      second.close(opened.id, {
        kmFinal: 1400, dataFimISO: '2026-09-29', horaFimISO: '18:00',
        consumoReferencia: 25, precoReferencia: 6,
      }),
    ]);
    expect(resultA).toEqual(resultB);
    expect((await getDocFromServer(doc(db, 'users', uid, 'jornadas', opened.id))).data()?.kmFinal)
      .toBe(resultA.kmFinal);
    expect((await getDocFromServer(doc(db, 'users', uid, 'jornadaState', 'current'))).data()?.activeJornadaId)
      .toBeNull();
  });

  it('não perde uma jornada legada aberta sem documento de controle', async () => {
    const id = 'legacy-open';
    const legacyRef = doc(db, 'users', uid, 'jornadas', id);
    await setDoc(legacyRef, {
      status: 'open', kmInicial: 500, dataInicioISO: '2026-09-29', horaInicioISO: '07:00',
      kmFinal: null, dataFimISO: null, horaFimISO: null, consumoReferencia: null,
      origemConsumo: null, precoReferencia: null, origemPreco: null, custoEstimado: null,
      createdAt: 1, updatedAt: 1,
    });
    const service = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const same = await service.start({ kmInicial: 500, dataInicioISO: '2026-09-29', horaInicioISO: '07:00' });
    expect(same.id).toBe(id);
    await expect(service.start({ kmInicial: 501, dataInicioISO: '2026-09-29', horaInicioISO: '07:01' }))
      .rejects.toThrow('Já existe uma jornada em aberto');
    const closed = await service.close(id, {
      kmFinal: 600, dataFimISO: '2026-09-29', horaFimISO: '17:00', consumoReferencia: 25,
    });
    expect(closed.status).toBe('closed');
    const next = await service.start({ kmInicial: 600, dataInicioISO: '2026-09-30', horaInicioISO: '08:00' });
    expect(next.id).not.toBe(id);
    expect((await getDocFromServer(legacyRef)).data()?.kmFinal).toBe(600);
    expect((await getDocFromServer(doc(db, 'users', uid, 'jornadaState', 'current'))).data()?.activeJornadaId)
      .toBe(next.id);
  });

  it('duplo início idêntico devolve a mesma jornada sem duplicar documento', async () => {
    const first = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const second = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const data = { kmInicial: 800, dataInicioISO: '2026-09-29', horaInicioISO: '08:00' };
    const [a, b] = await Promise.all([first.start(data), second.start(data)]);
    expect(a.id).toBe(b.id);
    expect((await getDocsFromServer(collection(db, 'users', uid, 'jornadas'))).size).toBe(1);
  });

  it('retry após resposta perdida e fechamento remoto não reabre a jornada', async () => {
    const data = { kmInicial: 1500, dataInicioISO: '2026-09-29', horaInicioISO: '08:00' };
    const first = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const opened = await first.start(data);
    await first.close(opened.id, {
      kmFinal: 1600, dataFimISO: '2026-09-29', horaFimISO: '18:00', consumoReferencia: 25,
    });
    const reloaded = new JornadaService(new FirestoreJornadaRepository(() => uid));
    const retried = await reloaded.start(data);
    expect(retried).toMatchObject({ id: opened.id, status: 'closed', kmFinal: 1600 });
    const all = await reloaded.list();
    expect(all).toHaveLength(1);
    expect(all.filter((item) => item.status === 'open')).toHaveLength(0);
  });

  it('reconhece tentativa legada já encerrada sem reabrir jornada', async () => {
    const ref = doc(db, 'users', uid, 'jornadas', 'legacy-closed');
    const data = { kmInicial: 1700, dataInicioISO: '2026-09-29', horaInicioISO: '09:00' };
    await setDoc(ref, {
      ...data, status: 'closed', kmFinal: 1800, dataFimISO: '2026-09-29',
      horaFimISO: '18:00', createdAt: 1, updatedAt: 2,
    });
    const retried = await new JornadaService(new FirestoreJornadaRepository(() => uid)).start(data);
    expect(retried).toMatchObject({ id: 'legacy-closed', status: 'closed', kmFinal: 1800 });
    expect((await getDocsFromServer(collection(db, 'users', uid, 'jornadas'))).size).toBe(1);
  });
});
