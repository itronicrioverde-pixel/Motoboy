/**
 * Mapeadores ESTRITOS domínio↔documento Firestore (DEC-019.3A). Puro: sem
 * firebase-admin. Sem defaults silenciosos — campo ausente ou fora do tipo
 * ESPERADO gera erro; nada é coagido/inventado. Os `serverTimestamp` são
 * aplicados pelo adapter (não aqui); estes mapeadores tratam só os campos
 * de dados e validam a leitura.
 */

import {
  validatePricingArea,
  normalizePricingName,
  type PricingArea,
  type PricingAreaType,
} from '../../../../src/features/pricing/domain';
import type { Cents } from '../../../../src/shared/currency';
import type { PublishAreaPlan } from '../ports';

const PRICING_AREA_TYPES: readonly PricingAreaType[] = ['bairro', 'area', 'condominio', 'empresa', 'ponto_referencia'];

function asObject(v: unknown, ctx: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object') throw new Error(`documento inválido (${ctx}): não é objeto`);
  return v as Record<string, unknown>;
}
function asString(v: unknown, ctx: string): string {
  if (typeof v !== 'string') throw new Error(`campo inválido (${ctx}): esperado string`);
  return v;
}
function asPositiveIntCents(v: unknown, ctx: string): Cents {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error(`campo inválido (${ctx}): esperado inteiro > 0`);
  return v as Cents;
}
function asIntGteZero(v: unknown, ctx: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error(`campo inválido (${ctx}): esperado inteiro >= 0`);
  return v;
}
function asStringOrNull(v: unknown, ctx: string): string | null {
  if (v === null) return null;
  return asString(v, ctx);
}
function asStringArray(v: unknown, ctx: string): string[] {
  if (!Array.isArray(v)) throw new Error(`campo inválido (${ctx}): esperado array`);
  return v.map((x, i) => asString(x, `${ctx}[${i}]`));
}

// ---- área ----

export function areaToDoc(area: PricingArea): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    displayName: area.displayName,
    nameNormalized: area.nameNormalized,
    aliases: [...area.aliases],
    amountCents: area.amountCents as number,
  };
  if (area.type !== undefined) doc.type = area.type;
  return doc;
}

export function areaPlanToDoc(item: PublishAreaPlan): Record<string, unknown> {
  return {
    displayName: item.displayName,
    nameNormalized: item.nameNormalized,
    aliases: [...item.aliases],
    amountCents: item.amountCents as number,
  };
}

export function areaFromDoc(areaId: string, data: unknown): PricingArea {
  const o = asObject(data, 'area');
  const displayName = asString(o.displayName, 'area.displayName');
  const nameNormalized = asString(o.nameNormalized, 'area.nameNormalized');
  const aliases = asStringArray(o.aliases, 'area.aliases');
  const amountCents = asPositiveIntCents(o.amountCents, 'area.amountCents');
  // sem correção silenciosa: o normalizado gravado precisa ser coerente.
  if (nameNormalized !== normalizePricingName(displayName)) throw new Error('area.nameNormalized incoerente com displayName');
  let type: PricingAreaType | undefined;
  if (o.type !== undefined) {
    const t = asString(o.type, 'area.type');
    if (!(PRICING_AREA_TYPES as readonly string[]).includes(t)) throw new Error('area.type inválido');
    type = t as PricingAreaType;
  }
  const area: PricingArea = { id: areaId, displayName, nameNormalized, aliases, amountCents, ...(type !== undefined ? { type } : {}) };
  const v = validatePricingArea(area);
  if (!v.ok) throw new Error('area inválida: ' + v.code);
  return area;
}

// ---- ponteiro ativo ----

export interface ActiveConfigData {
  readonly activeVersionId: string | null;
  readonly revision: number;
}
export function activeConfigFromDoc(data: unknown): ActiveConfigData {
  const o = asObject(data, 'activeConfig');
  return {
    activeVersionId: asStringOrNull(o.activeVersionId, 'activeConfig.activeVersionId'),
    revision: asIntGteZero(o.revision, 'activeConfig.revision'),
  };
}

// ---- ativação (histórico + ledger de idempotência) ----

export interface ActivationData {
  readonly versionId: string;
  readonly revision: number;
  readonly requestHash: string;
  readonly previousVersionId: string | null;
  readonly operation: 'publish';
}
export function activationToDoc(a: { versionId: string; revision: number; activatedBy: string; requestHash: string; previousVersionId: string | null }): Record<string, unknown> {
  return {
    versionId: a.versionId,
    revision: a.revision,
    activatedBy: a.activatedBy,
    operation: 'publish',
    previousVersionId: a.previousVersionId,
    requestHash: a.requestHash,
  };
}
export function activationFromDoc(data: unknown): ActivationData {
  const o = asObject(data, 'activation');
  const operation = asString(o.operation, 'activation.operation');
  if (operation !== 'publish') throw new Error('activation.operation inesperada: ' + operation);
  return {
    versionId: asString(o.versionId, 'activation.versionId'),
    revision: asIntGteZero(o.revision, 'activation.revision'),
    requestHash: asString(o.requestHash, 'activation.requestHash'),
    previousVersionId: asStringOrNull(o.previousVersionId, 'activation.previousVersionId'),
    operation: 'publish',
  };
}

// ---- metadados da versão ----

export function versionMetaToDoc(m: { source: 'paste'; itemCount: number; publishedBy: string; previousVersionId: string | null }): Record<string, unknown> {
  return {
    source: m.source,
    itemCount: m.itemCount,
    status: 'published',
    publishedBy: m.publishedBy,
    previousVersionId: m.previousVersionId,
  };
}
