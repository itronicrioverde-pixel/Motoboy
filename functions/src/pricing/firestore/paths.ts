/**
 * Construtores de caminhos Firestore da Tabela de deslocamento (DEC-019.3A).
 * Puro: sem firebase-admin. Tudo sob `users/{uid}` (isolamento por dono).
 *
 * A ativação é DETERMINÍSTICA por idempotencyKey (`pub_{key}`) e serve de
 * histórico imutável E de ledger de idempotência; a versão também é
 * determinística (`ver_{key}`), de modo que retries não criem duplicatas.
 */

function assertSegment(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
    throw new Error(`segmento de caminho inválido (${label}): ${String(value)}`);
  }
  return value;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export function activationDocId(idempotencyKey: string): string {
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error('idempotencyKey inválida');
  return 'pub_' + idempotencyKey;
}

export function versionIdOf(idempotencyKey: string): string {
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error('idempotencyKey inválida');
  return 'ver_' + idempotencyKey;
}

export const pricingPaths = {
  activeConfig(uid: string): string {
    return `users/${assertSegment(uid, 'uid')}/pricingConfig/active`;
  },
  version(uid: string, versionId: string): string {
    return `users/${assertSegment(uid, 'uid')}/pricingTables/${assertSegment(versionId, 'versionId')}`;
  },
  areasCol(uid: string, versionId: string): string {
    return `users/${assertSegment(uid, 'uid')}/pricingTables/${assertSegment(versionId, 'versionId')}/areas`;
  },
  area(uid: string, versionId: string, areaId: string): string {
    return `users/${assertSegment(uid, 'uid')}/pricingTables/${assertSegment(versionId, 'versionId')}/areas/${assertSegment(areaId, 'areaId')}`;
  },
  activation(uid: string, idempotencyKey: string): string {
    return `users/${assertSegment(uid, 'uid')}/pricingTableActivations/${activationDocId(idempotencyKey)}`;
  },
} as const;
