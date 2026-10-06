import { deleteApp, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
  setDoc,
  terminate,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApplyReceiptInput } from './client-writer';

const uid = 'beta-transaction-user';
const routeId = 'beta-race-route';
const receiptOperationId = 'beta-race-receipt';

let app: FirebaseApp;
let db: Firestore;
let writer: typeof import('./client-writer');

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

  app = initializeApp({ projectId }, 'client-writer-emulator');
  db = getFirestore(app);
  connectFirestoreEmulator(db, host, port, { mockUserToken: { sub: uid } });
  vi.doMock('../../../config/firebase.js', () => ({ db }));
  vi.doMock('../../auth/application/auth-service', () => ({ currentUid: () => uid }));
  writer = await import('./client-writer');
});

afterAll(async () => {
  vi.doUnmock('../../../config/firebase.js');
  vi.doUnmock('../../auth/application/auth-service');
  if (db) await terminate(db);
  if (app) await deleteApp(app);
});

describe('ClientWriter no Firestore Emulator — concorrência financeira', () => {
  it('recebimento e cancelamento concorrentes nunca deixam conta órfã ou entrada duplicada', async () => {
    const clientsRef = doc(db, 'users', uid, 'clients', 'data');
    const routeRef = doc(db, 'users', uid, 'rotas', routeId);
    const entryRef = doc(db, 'users', uid, 'entradas', receiptOperationId);
    await setDoc(clientsRef, {
      clientes: [{
        id: 'beta-client', nome: 'Ana', pendente: 50,
        contas: [{ routeId, saldo: 50, recebido: 0, operationId: `${routeId}:service-1` }],
        recebimentos: [],
      }],
    });
    await setDoc(routeRef, { status: 'confirmed' });

    const receipt: ApplyReceiptInput = {
      clientId: 'beta-client',
      clientName: 'Ana',
      valor: 20,
      dateISO: '2026-09-28',
      dateLabel: '28/09/2026',
      receiptOperationId,
    };
    const [received, cancelled] = await Promise.allSettled([
      writer.applyReceiptDual(receipt),
      writer.cancelRouteDual(routeId),
    ]);

    const [clientsSnap, routeSnap, entrySnap] = await Promise.all([
      getDocFromServer(clientsRef),
      getDocFromServer(routeRef),
      getDocFromServer(entryRef),
    ]);
    const clients = clientsSnap.data()?.clientes as Array<{
      pendente: number;
      contas: Array<{ routeId: string; saldo: number; recebido: number }>;
      recebimentos: unknown[];
    }>;
    expect(clients).toHaveLength(1);

    if (cancelled.status === 'fulfilled') {
      expect(received.status).toBe('rejected');
      expect(routeSnap.exists()).toBe(false);
      expect(entrySnap.exists()).toBe(false);
      expect(clients[0].pendente).toBe(0);
      expect(clients[0].contas).toHaveLength(0);
      expect(clients[0].recebimentos).toHaveLength(0);
    } else {
      expect(received.status).toBe('fulfilled');
      expect(routeSnap.exists()).toBe(true);
      expect(entrySnap.exists()).toBe(true);
      expect(clients[0].pendente).toBe(30);
      expect(clients[0].contas).toHaveLength(1);
      expect(clients[0].contas[0].recebido).toBe(20);
      expect(clients[0].recebimentos).toHaveLength(1);
    }
  });
});
