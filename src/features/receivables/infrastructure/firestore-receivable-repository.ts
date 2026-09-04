/**
 * Implementação Firestore do ReceivableRepository (infraestrutura).
 * Guarda cada recebível em users/{uid}/receivables, isolado por dono.
 */

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { Cents } from '../../../shared/currency';
import type { Receivable, ReceivableRepository } from '../domain/receivable';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toEntity(snapshot: QueryDocumentSnapshot<DocumentData>): Receivable {
  const d = snapshot.data();
  return {
    id: snapshot.id,
    clientId: String(d.clientId ?? ''),
    sourceType: d.sourceType === 'manual' ? 'manual' : 'route',
    sourceId: String(d.sourceId ?? ''),
    serviceId: d.serviceId ? String(d.serviceId) : undefined,
    description: String(d.description ?? ''),
    amountCents: toNumber(d.amountCents) as Cents,
    paidCents: toNumber(d.paidCents) as Cents,
    status: (d.status as Receivable['status']) ?? 'open',
    effectiveDate: String(d.effectiveDate ?? ''),
    createdAtEpochMs: toNumber(d.createdAtEpochMs, Date.now()),
  };
}

export class FirestoreReceivableRepository implements ReceivableRepository {
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'receivables');
  }

  async list(): Promise<Receivable[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('effectiveDate', 'desc')));
    return snap.docs.map(toEntity);
  }

  async listByClient(clientId: string): Promise<Receivable[]> {
    const snap = await getDocs(
      query(this.collectionRef(), where('clientId', '==', clientId), orderBy('effectiveDate', 'desc')),
    );
    return snap.docs.map(toEntity);
  }

  async listOpenByClient(clientId: string): Promise<Receivable[]> {
    const snap = await getDocs(
      query(
        this.collectionRef(),
        where('clientId', '==', clientId),
        where('status', 'in', ['open', 'partial']),
        orderBy('effectiveDate', 'asc'),
      ),
    );
    return snap.docs.map(toEntity);
  }

  observe(callback: (items: Receivable[]) => void): () => void {
    return onSnapshot(query(this.collectionRef(), orderBy('effectiveDate', 'desc')), (snap) => {
      callback(snap.docs.map(toEntity));
    });
  }

  async save(receivable: Receivable): Promise<void> {
    const payload = {
      clientId: receivable.clientId,
      sourceType: receivable.sourceType,
      sourceId: receivable.sourceId,
      serviceId: receivable.serviceId ?? null,
      description: receivable.description,
      amountCents: receivable.amountCents,
      paidCents: receivable.paidCents,
      status: receivable.status,
      effectiveDate: receivable.effectiveDate,
      createdAtEpochMs: receivable.createdAtEpochMs,
    };
    await addDoc(this.collectionRef(), payload);
  }

  async saveBatch(receivables: readonly Receivable[]): Promise<void> {
    for (const r of receivables) {
      await this.save(r);
    }
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef(), id));
  }
}
