/**
 * Adapter Admin/Firestore da porta transacional de publicação (DEC-019.3A).
 *
 * Uma única transação Admin, com a ordem exigida:
 *  1) lê o LEDGER `pricingTableActivations/pub_{idempotencyKey}` ANTES do ponteiro
 *     — se existir: mesmo `requestHash` → devolve o resultado gravado
 *     (`idempotentReplay:true`); `requestHash` diferente → REQUEST_HASH_MISMATCH;
 *  2) só então lê `pricingConfig/active` e confere `expectedActiveVersionId` /
 *     `expectedRevision` (concorrência);
 *  3) cria versão (`ver_{key}`, determinística) + áreas + ativação (`pub_{key}`) e
 *     troca o ponteiro incrementando `revision` — tudo-ou-nada.
 *
 * IDs determinísticos ⇒ retries não duplicam versões/áreas. Versões, áreas e
 * ativações são imutáveis (nunca update/delete). Admin ignora Rules.
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { CommitPublishRequest, CommitPublishResult, PricingPublishTransaction } from '../ports';
import { pricingPaths, versionIdOf } from './paths';
import { activationFromDoc, activeConfigFromDoc, activationToDoc, areaPlanToDoc, versionMetaToDoc } from './mappers';

type TxOutcome =
  | { kind: 'replay' | 'published'; versionId: string; revision: number; activationId: string }
  | { kind: 'mismatch' }
  | { kind: 'conflict' };

export class PricingPublishTransactionAdmin implements PricingPublishTransaction {
  constructor(private readonly db: Firestore) {}

  async commit(request: CommitPublishRequest): Promise<CommitPublishResult> {
    const uid = request.uid;
    const activationRef = this.db.doc(pricingPaths.activation(uid, request.idempotencyKey));
    const configRef = this.db.doc(pricingPaths.activeConfig(uid));

    try {
      const outcome = await this.db.runTransaction<TxOutcome>(async (tx) => {
        // 1) LEDGER de idempotência ANTES do ponteiro.
        const actSnap = await tx.get(activationRef);
        if (actSnap.exists) {
          const act = activationFromDoc(actSnap.data());
          if (act.requestHash !== request.requestHash) return { kind: 'mismatch' };
          return { kind: 'replay', versionId: act.versionId, revision: act.revision, activationId: activationRef.id };
        }

        // 2) concorrência.
        const cfgSnap = await tx.get(configRef);
        const current = cfgSnap.exists ? activeConfigFromDoc(cfgSnap.data()) : { activeVersionId: null, revision: 0 };
        if (request.expectedActiveVersionId !== current.activeVersionId || request.expectedRevision !== current.revision) {
          return { kind: 'conflict' };
        }

        // 3) escrita atômica (versão + áreas + ativação + ponteiro).
        const versionId = versionIdOf(request.idempotencyKey);
        const revision = current.revision + 1;
        const versionRef = this.db.doc(pricingPaths.version(uid, versionId));

        tx.create(versionRef, {
          ...versionMetaToDoc({ source: request.plan.source, itemCount: request.plan.items.length, publishedBy: uid, previousVersionId: request.plan.previousVersionId }),
          createdAt: FieldValue.serverTimestamp(),
        });
        for (const item of request.plan.items) {
          tx.create(this.db.doc(pricingPaths.area(uid, versionId, item.areaId)), areaPlanToDoc(item));
        }
        tx.create(activationRef, {
          ...activationToDoc({ versionId, revision, activatedBy: uid, requestHash: request.requestHash, previousVersionId: request.plan.previousVersionId }),
          activatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(configRef, { activeVersionId: versionId, revision, updatedAt: FieldValue.serverTimestamp() });

        return { kind: 'published', versionId, revision, activationId: activationRef.id };
      });

      if (outcome.kind === 'mismatch') return { ok: false, code: 'REQUEST_HASH_MISMATCH', message: 'hash diferente para a mesma chave' };
      if (outcome.kind === 'conflict') return { ok: false, code: 'CONCURRENT_MODIFICATION', message: 'ponteiro/revisão mudou' };
      return { ok: true, durable: true, versionId: outcome.versionId, revision: outcome.revision, activationId: outcome.activationId, idempotentReplay: outcome.kind === 'replay' };
    } catch {
      return { ok: false, code: 'REJECTED', message: 'transação falhou' };
    }
  }
}
