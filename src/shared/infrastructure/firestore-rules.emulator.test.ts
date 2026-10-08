import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

const paths = [
  ['clientes (perfil)', 'customers/client-1'],
  ['clientes (financeiro)', 'clients/data'],
  ['moto', 'moto/data'],
  ['tentativa de consumo manual', 'motoConsumptionAttempts/manual-1'],
  ['abastecimentos', 'abastecimentos/refuel-1'],
  ['manutenções', 'manutencoes/maint-1'],
  ['faturamento', 'entradas/entry-1'],
  ['tentativas de criação', 'createAttempts/entradas_entry-1'],
  ['jornada', 'jornadas/journey-1'],
  ['controle de jornada', 'jornadaState/current'],
] as const;

let env: RulesTestEnvironment;

beforeAll(async () => {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error('FIRESTORE_EMULATOR_HOST obrigatório para testes de Rules.');
  const [host, rawPort] = address.split(':');
  const port = Number(rawPort);
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new Error(`FIRESTORE_EMULATOR_HOST inválido: ${address}`);
  }
  const projectId = process.env.GCLOUD_PROJECT ?? 'demo-motoboy';
  if (!projectId.startsWith('demo-')) {
    throw new Error('Testes de Rules exigem um projeto demo-* para evitar dados reais.');
  }
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env?.cleanup(); });

describe('Firestore Rules — coleções do beta', () => {
  it.each(paths)('%s: proprietário acessa; outro UID e anônimo são bloqueados', async (_label, relativePath) => {
    const owner = env.authenticatedContext('beta-owner');
    const other = env.authenticatedContext('beta-other');
    const anonymous = env.unauthenticatedContext();
    const path = `users/beta-owner/${relativePath}`;
    const collectionPath = path.slice(0, path.lastIndexOf('/'));

    await assertSucceeds(owner.firestore().doc(path).set({ marker: 'owner' }));
    const ownDocument = await assertSucceeds(owner.firestore().doc(path).get());
    expect(ownDocument.data()?.marker).toBe('owner');
    const ownList = await assertSucceeds(owner.firestore().collection(collectionPath).get());
    expect(ownList.size).toBe(1);

    await assertFails(other.firestore().doc(path).get());
    await assertFails(other.firestore().doc(path).set({ marker: 'intruder' }));
    await assertFails(other.firestore().collection(collectionPath).get());
    await assertFails(anonymous.firestore().doc(path).get());
    await assertFails(anonymous.firestore().doc(path).set({ marker: 'anonymous' }));
    await assertFails(anonymous.firestore().collection(collectionPath).get());

    const after = await assertSucceeds(owner.firestore().doc(path).get());
    expect(after.data()?.marker).toBe('owner');
  });

  it('nega caminhos fora de users/{uid} até para usuário autenticado', async () => {
    const owner = env.authenticatedContext('beta-owner');
    await assertFails(owner.firestore().doc('public/example').set({ marker: 'blocked' }));
    await assertFails(owner.firestore().doc('public/example').get());
  });
});
