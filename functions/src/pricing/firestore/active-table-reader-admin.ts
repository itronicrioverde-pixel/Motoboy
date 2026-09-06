/**
 * Adapter Admin/Firestore de leitura da tabela ativa (DEC-019.3A). Lê o ponteiro
 * `pricingConfig/active` e as `areas` da versão ativa por `uid`. Mapeadores
 * estritos; falha vira Result discriminado (nunca lança). Admin ignora Rules.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { ActiveTableReadResult, PricingActiveTableReader } from '../ports';
import { pricingPaths } from './paths';
import { activeConfigFromDoc, areaFromDoc } from './mappers';

export class PricingActiveTableReaderAdmin implements PricingActiveTableReader {
  constructor(private readonly db: Firestore) {}

  async loadActiveTable(uid: string): Promise<ActiveTableReadResult> {
    try {
      const cfgSnap = await this.db.doc(pricingPaths.activeConfig(uid)).get();
      if (!cfgSnap.exists) return { ok: true, value: { activeVersionId: null, revision: 0, areas: [] } };
      const cfg = activeConfigFromDoc(cfgSnap.data());
      if (cfg.activeVersionId === null) return { ok: true, value: { activeVersionId: null, revision: cfg.revision, areas: [] } };
      const areasSnap = await this.db.collection(pricingPaths.areasCol(uid, cfg.activeVersionId)).get();
      const areas = areasSnap.docs.map((d) => areaFromDoc(d.id, d.data()));
      return { ok: true, value: { activeVersionId: cfg.activeVersionId, revision: cfg.revision, areas } };
    } catch {
      return { ok: false, code: 'READ_FAILED', message: 'falha ao ler a tabela ativa' };
    }
  }
}
