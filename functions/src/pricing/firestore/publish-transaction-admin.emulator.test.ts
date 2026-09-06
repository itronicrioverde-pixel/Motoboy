import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { toCents, type Cents } from '../../../../src/shared/currency';
import {
  parsePricingTablePaste,
  buildPricingAnalysisKey,
  buildIssueReferences,
  type PricingImportDecision,
} from '../../../../src/features/pricing/domain';
import { publishPricingTable, type PublishPricingTableDeps, type PublishPricingTableInput } from '../publish-pricing-table';
import { Sha256RequestHasher } from '../sha256-request-hasher';
import { PricingActiveTableReaderAdmin } from './active-table-reader-admin';
import { PricingPublishTransactionAdmin } from './publish-transaction-admin';
import { PricingIdGeneratorAdmin } from './id-generator-admin';
import { pricingPaths, versionIdOf } from './paths';
import type { CommitPublishRequest } from '../ports';

let app: App;
let db: Firestore;

beforeAll(() => {
  // Recusa Firebase real: exige Emulator e projeto descartável demo-*.
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST ausente — recuse Firebase real');
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-motoboy';
  if (!projectId.startsWith('demo-')) throw new Error('projeto não descartável (exigido demo-*): ' + projectId);
  app = initializeApp({ projectId }, 'emulator-3a');
  db = getFirestore(app);
});
afterAll(async () => {
  if (app) await deleteApp(app);
});

function deps(): PublishPricingTableDeps {
  return {
    reader: new PricingActiveTableReaderAdmin(db),
    ids: new PricingIdGeneratorAdmin(),
    hasher: new Sha256RequestHasher(),
    transaction: new PricingPublishTransactionAdmin(db),
  };
}

const TEXT = 'R$10,00\nCentro\nNilson Veloso I e II';
function groupingId(text: string): string {
  const parse = parsePricingTablePaste(text);
  if (!parse.ok) throw new Error('parse');
  const kr = buildPricingAnalysisKey(text, parse);
  if (!kr.ok) throw new Error('key');
  const r = buildIssueReferences(parse.issues, kr.key).find((x) => x.code === 'AMBIGUOUS_GROUPING');
  if (!r) throw new Error('sem grouping');
  return r.issueId;
}
function splitDecisions(): PricingImportDecision[] {
  return [{ kind: 'SplitGroupingIntoAreas', issueId: groupingId(TEXT), names: ['Nilson Veloso I', 'Nilson Veloso II'] }];
}
function input(uid: string, over: Partial<PublishPricingTableInput> = {}): PublishPricingTableInput {
  return { uid, rawText: TEXT, decisions: splitDecisions(), expectedActiveVersionId: null, expectedRevision: 0, idempotencyKey: 'idem1234abcd', ...over };
}

let seq = 0;
function uid(): string {
  seq += 1;
  return 'user_t' + seq;
}

describe('PricingPublishTransactionAdmin (Firestore Emulator)', () => {
  it('primeira publicação grava versão, áreas, ativação e ponteiro', async () => {
    const u = uid();
    const r = await publishPricingTable(deps(), input(u));
    expect(r.state).toBe('published');
    if (r.state === 'published') expect(r.revision).toBe(1);

    const cfg = (await db.doc(pricingPaths.activeConfig(u)).get()).data();
    expect(cfg?.activeVersionId).toBe(versionIdOf('idem1234abcd'));
    expect(cfg?.revision).toBe(1);
    const areas = await db.collection(pricingPaths.areasCol(u, versionIdOf('idem1234abcd'))).get();
    expect(areas.size).toBe(3);
    const act = (await db.doc(pricingPaths.activation(u, 'idem1234abcd')).get()).data();
    expect(act?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(act?.versionId).toBe(versionIdOf('idem1234abcd'));
    expect(act?.operation).toBe('publish');
  });

  it('nova versão avança ponteiro e preserva a anterior (imutável)', async () => {
    const u = uid();
    await publishPricingTable(deps(), input(u, { idempotencyKey: 'keyone12345' }));
    const v1 = versionIdOf('keyone12345');
    const v1AreasBefore = (await db.collection(pricingPaths.areasCol(u, v1)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

    const r2 = await publishPricingTable(deps(), input(u, {
      idempotencyKey: 'keytwo12345',
      rawText: 'R$20,00\nCentro\nSul',
      decisions: [],
      expectedActiveVersionId: v1,
      expectedRevision: 1,
    }));
    expect(r2.state).toBe('published');
    if (r2.state === 'published') expect(r2.revision).toBe(2);

    const cfg = (await db.doc(pricingPaths.activeConfig(u)).get()).data();
    expect(cfg?.activeVersionId).toBe(versionIdOf('keytwo12345'));
    expect(cfg?.revision).toBe(2);
    const v2meta = (await db.doc(pricingPaths.version(u, versionIdOf('keytwo12345'))).get()).data();
    expect(v2meta?.previousVersionId).toBe(v1);

    // v1 intacta
    const v1AreasAfter = (await db.collection(pricingPaths.areasCol(u, v1)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    expect(v1AreasAfter).toEqual(v1AreasBefore);
  });

  it('replay idempotente: ledger antes do ponteiro; 2º submit não cria nova versão', async () => {
    const u = uid();
    const r1 = await publishPricingTable(deps(), input(u)); // rev -> 1
    // 2º submit com o MESMO expected (0/null): a concorrência falharia (rev=1),
    // mas o ledger é lido antes do ponteiro e devolve o resultado gravado.
    const r2 = await publishPricingTable(deps(), input(u));
    expect(r1.state).toBe('published');
    expect(r2.state).toBe('published');
    if (r2.state === 'published') expect(r2.idempotentReplay).toBe(true);
    const versions = await db.collection(`users/${u}/pricingTables`).get();
    expect(versions.size).toBe(1);
  });

  it('mesma key + hash diferente -> REQUEST_HASH_MISMATCH, sem nova versão', async () => {
    const u = uid();
    await publishPricingTable(deps(), input(u)); // decisões = split
    // mesma key, mesmo texto, decisão DIFERENTE (válida) -> requestHash diferente
    const other = await publishPricingTable(deps(), input(u, { decisions: [{ kind: 'KeepGroupingAsSingleArea', issueId: groupingId(TEXT) }] }));
    expect(other.state).toBe('error');
    if (other.state === 'error') expect(other.code).toBe('REQUEST_HASH_MISMATCH');
    const versions = await db.collection(`users/${u}/pricingTables`).get();
    expect(versions.size).toBe(1);
  });

  it('concorrência: expected divergente -> conflict, sem nova versão', async () => {
    const u = uid();
    await publishPricingTable(deps(), input(u, { idempotencyKey: 'keyone12345' })); // rev -> 1
    const r = await publishPricingTable(deps(), input(u, { idempotencyKey: 'keytwo12345', expectedActiveVersionId: null, expectedRevision: 0 }));
    expect(r.state).toBe('conflict');
    const versions = await db.collection(`users/${u}/pricingTables`).get();
    expect(versions.size).toBe(1);
  });

  it('rollback: falha no meio da transação não deixa escrita parcial', async () => {
    const u = uid();
    const tx = new PricingPublishTransactionAdmin(db);
    const req: CommitPublishRequest = {
      uid: u,
      idempotencyKey: 'rollback1234',
      requestHash: new Sha256RequestHasher().hashCanonical('carga'),
      expectedActiveVersionId: null,
      expectedRevision: 0,
      plan: { uid: u, source: 'paste', items: [{ areaId: '', displayName: 'X', nameNormalized: 'x', aliases: [], amountCents: toCents(1000) as Cents }], previousVersionId: null },
    };
    const r = await tx.commit(req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REJECTED');
    expect((await db.doc(pricingPaths.activeConfig(u)).get()).exists).toBe(false);
    expect((await db.collection(`users/${u}/pricingTables`).get()).size).toBe(0);
    expect((await db.doc(pricingPaths.activation(u, 'rollback1234')).get()).exists).toBe(false);
  });

  it('isolamento entre dois uid', async () => {
    const a = uid();
    const b = uid();
    await publishPricingTable(deps(), input(a, { idempotencyKey: 'keyaaa12345' }));
    expect((await db.doc(pricingPaths.activeConfig(b)).get()).exists).toBe(false);
    await publishPricingTable(deps(), input(b, { idempotencyKey: 'keybbb12345' }));
    const acfg = (await db.doc(pricingPaths.activeConfig(a)).get()).data();
    expect(acfg?.activeVersionId).toBe(versionIdOf('keyaaa12345'));
    expect(acfg?.revision).toBe(1);
    const bcfg = (await db.doc(pricingPaths.activeConfig(b)).get()).data();
    expect(bcfg?.activeVersionId).toBe(versionIdOf('keybbb12345'));
  });
});
