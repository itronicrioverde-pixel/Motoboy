/**
 * Implementação Firestore do PricingTableReadRepository (infraestrutura).
 * Lê a tabela de deslocamento ativa de users/{uid}/pricing/active.
 *
 * A publicação (escrita) é feita pelo callable no servidor — o cliente só lê.
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { Cents } from '../../../shared/currency';
import type {
  PricingTableReadResult,
  PricingTableReadRepository,
} from '../application/ports/pricing-table-read-repository';
import type { PricingArea } from '../domain/pricing-area';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPricingArea(raw: Record<string, unknown>): PricingArea {
  return {
    id: String(raw.id ?? ''),
    displayName: String(raw.displayName ?? ''),
    nameNormalized: String(raw.nameNormalized ?? ''),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
    ...(raw.type ? { type: raw.type as PricingArea['type'] } : {}),
    amountCents: toNumber(raw.amountCents) as Cents,
  };
}

export class FirestorePricingReadRepository implements PricingTableReadRepository {
  constructor(private readonly getUid: () => string | null) {}

  async loadActivePricingTable(): Promise<PricingTableReadResult> {
    const uid = this.getUid();
    if (!uid) {
      return { ok: false, code: 'READ_FAILED', message: 'Sem usuário autenticado.' };
    }

    try {
      const snap = await getDoc(doc(db, 'users', uid, 'pricing', 'active'));
      if (!snap.exists()) {
        return {
          ok: true,
          value: {
            activeVersionId: null,
            revision: 0,
            areas: [],
          },
        };
      }

      const data = snap.data();
      const areas = Array.isArray(data.areas)
        ? data.areas.map((a: Record<string, unknown>) => toPricingArea(a))
        : [];

      return {
        ok: true,
        value: {
          activeVersionId: data.activeVersionId ? String(data.activeVersionId) : null,
          revision: toNumber(data.revision),
          areas,
        },
      };
    } catch {
      return { ok: false, code: 'READ_FAILED', message: 'Erro ao ler tabela de deslocamento.' };
    }
  }
}
