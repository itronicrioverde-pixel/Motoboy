/**
 * Implementação Firestore do IncomeRepository (infraestrutura).
 * Guarda cada entrada em users/{uid}/income, isolado por dono.
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
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { Cents } from '../../../shared/currency';
import type { IncomeEntry, IncomeRepository } from '../domain/income-entry';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toEntity(snapshot: QueryDocumentSnapshot<DocumentData>): IncomeEntry {
  const d = snapshot.data();
  return {
    id: snapshot.id,
    direction: d.direction === 'debit' ? 'debit' : 'credit',
    amountCents: toNumber(d.amountCents) as Cents,
    sourceType: d.sourceType === 'manual' ? 'manual' : 'payment',
    sourceId: String(d.sourceId ?? ''),
    reversesIncomeEntryId: d.reversesIncomeEntryId ? String(d.reversesIncomeEntryId) : undefined,
    description: String(d.description ?? ''),
    effectiveDate: String(d.effectiveDate ?? ''),
  };
}

export class FirestoreIncomeRepository implements IncomeRepository {
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'income');
  }

  async list(): Promise<IncomeEntry[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('effectiveDate', 'desc')));
    return snap.docs.map(toEntity);
  }

  observe(callback: (items: IncomeEntry[]) => void): () => void {
    return onSnapshot(query(this.collectionRef(), orderBy('effectiveDate', 'desc')), (snap) => {
      callback(snap.docs.map(toEntity));
    });
  }

  async save(entry: IncomeEntry): Promise<void> {
    const payload = {
      direction: entry.direction,
      amountCents: entry.amountCents,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversesIncomeEntryId: entry.reversesIncomeEntryId ?? null,
      description: entry.description,
      effectiveDate: entry.effectiveDate,
    };
    await addDoc(this.collectionRef(), payload);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef(), id));
  }
}
