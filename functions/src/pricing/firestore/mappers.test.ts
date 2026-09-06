import { describe, it, expect } from 'vitest';
import { toCents, type Cents } from '../../../../src/shared/currency';
import { createPricingArea, type PricingArea } from '../../../../src/features/pricing/domain';
import { areaToDoc, areaFromDoc, activeConfigFromDoc, activationFromDoc, activationToDoc, versionMetaToDoc } from './mappers';
import { pricingPaths, versionIdOf, activationDocId } from './paths';

function area(id: string, name: string, cents: number, aliases?: string[]): PricingArea {
  const r = createPricingArea({ id, displayName: name, amountCents: toCents(cents) as Cents, aliases });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}

describe('paths determinísticos', () => {
  it('activation/version usam pub_/ver_ + key; caminhos sob users/{uid}', () => {
    expect(activationDocId('idem1234')).toBe('pub_idem1234');
    expect(versionIdOf('idem1234')).toBe('ver_idem1234');
    expect(pricingPaths.activation('u1', 'idem1234')).toBe('users/u1/pricingTableActivations/pub_idem1234');
    expect(pricingPaths.activeConfig('u1')).toBe('users/u1/pricingConfig/active');
    expect(pricingPaths.area('u1', 'ver_idem1234', 'area_x')).toBe('users/u1/pricingTables/ver_idem1234/areas/area_x');
  });
  it('rejeita uid/key inválidos (sem defaults)', () => {
    expect(() => pricingPaths.activeConfig('a/b')).toThrow();
    expect(() => pricingPaths.activeConfig('')).toThrow();
    expect(() => activationDocId('short')).toThrow();
  });
});

describe('mapeadores estritos de área', () => {
  it('round-trip fiel', () => {
    const a = area('area_1', 'Centro', 1000, ['velho']);
    const doc = areaToDoc(a);
    expect(doc).toEqual({ displayName: 'Centro', nameNormalized: 'centro', aliases: ['velho'], amountCents: 1000 });
    expect(areaFromDoc('area_1', doc)).toEqual(a);
  });
  it('rejeita amountCents inválido, sem coerção', () => {
    expect(() => areaFromDoc('a', { displayName: 'X', nameNormalized: 'x', aliases: [], amountCents: 0 })).toThrow();
    expect(() => areaFromDoc('a', { displayName: 'X', nameNormalized: 'x', aliases: [], amountCents: 10.5 })).toThrow();
    expect(() => areaFromDoc('a', { displayName: 'X', nameNormalized: 'x', aliases: [] })).toThrow(); // ausente
  });
  it('rejeita nameNormalized incoerente e aliases não-array', () => {
    expect(() => areaFromDoc('a', { displayName: 'Centro', nameNormalized: 'errado', aliases: [], amountCents: 1000 })).toThrow();
    expect(() => areaFromDoc('a', { displayName: 'Centro', nameNormalized: 'centro', aliases: 'x', amountCents: 1000 })).toThrow();
  });
  it('rejeita type inválido', () => {
    expect(() => areaFromDoc('a', { displayName: 'Centro', nameNormalized: 'centro', aliases: [], amountCents: 1000, type: 'nope' })).toThrow();
  });
});

describe('mapeadores de config/ativação', () => {
  it('activeConfig estrito', () => {
    expect(activeConfigFromDoc({ activeVersionId: 'ver_x', revision: 2 })).toEqual({ activeVersionId: 'ver_x', revision: 2 });
    expect(activeConfigFromDoc({ activeVersionId: null, revision: 0 })).toEqual({ activeVersionId: null, revision: 0 });
    expect(() => activeConfigFromDoc({ activeVersionId: 'x', revision: -1 })).toThrow();
    expect(() => activeConfigFromDoc({ revision: 1 })).toThrow(); // activeVersionId ausente
  });
  it('activation round-trip + rejeições', () => {
    const doc = activationToDoc({ versionId: 'ver_x', revision: 1, activatedBy: 'u1', requestHash: 'abc', previousVersionId: null });
    expect(doc).toMatchObject({ versionId: 'ver_x', revision: 1, operation: 'publish', requestHash: 'abc', previousVersionId: null });
    expect(activationFromDoc(doc)).toEqual({ versionId: 'ver_x', revision: 1, requestHash: 'abc', previousVersionId: null, operation: 'publish' });
    expect(() => activationFromDoc({ ...doc, operation: 'reactivate' })).toThrow();
    expect(() => activationFromDoc({ ...doc, requestHash: 123 })).toThrow();
  });
  it('versionMeta tem status published e source', () => {
    expect(versionMetaToDoc({ source: 'paste', itemCount: 3, publishedBy: 'u1', previousVersionId: null })).toEqual({ source: 'paste', itemCount: 3, status: 'published', publishedBy: 'u1', previousVersionId: null });
  });
});
