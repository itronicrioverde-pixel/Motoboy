/**
 * Implementação Firestore do PaymentRepository (infraestrutura).
 * Guarda cada pagamento em users/{uid}/payments, isolado por dono.
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
import type { Payment, PaymentRepository, Allocation } from '../domain/payment';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toEntity(snapshot: QueryDocumentSnapshot<DocumentData>): Payment {
  const d = snapshot.data();
  const allocations: Allocation[] = Array.isArray(d.allocations)
    ? d.allocations.map((a: Record<string, unknown>) => ({
        receivableId: String(a.receivableId ?? ''),
        amountCents: toNumber(a.amountCents) as Cents,
      }))
    : [];

  return {
    id: snapshot.id,
    clientId: String(d.clientId ?? ''),
    amountCents: toNumber(d.amountCents) as Cents,
    allocations,
    effectiveDate: String(d.effectiveDate ?? ''),
    idempotencyKey: String(d.idempotencyKey ?? ''),
    requestHash: String(d.requestHash ?? ''),
    kind: d.kind === 'reversal' ? 'reversal' : 'payment',
    reversesPaymentId: d.reversesPaymentId ? String(d.reversesPaymentId) : undefined,
  };
}

export class FirestorePaymentRepository implements PaymentRepository {
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'payments');
  }

  async list(): Promise<Payment[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('effectiveDate', 'desc')));
    return snap.docs.map(toEntity);
  }

  async listByClient(clientId: string): Promise<Payment[]> {
    const snap = await getDocs(
      query(this.collectionRef(), where('clientId', '==', clientId), orderBy('effectiveDate', 'desc')),
    );
    return snap.docs.map(toEntity);
  }

  observe(callback: (items: Payment[]) => void): () => void {
    return onSnapshot(query(this.collectionRef(), orderBy('effectiveDate', 'desc')), (snap) => {
      callback(snap.docs.map(toEntity));
    });
  }

  async save(payment: Payment): Promise<void> {
    const payload = {
      clientId: payment.clientId,
      amountCents: payment.amountCents,
      allocations: payment.allocations.map((a) => ({
        receivableId: a.receivableId,
        amountCents: a.amountCents,
      })),
      effectiveDate: payment.effectiveDate,
      idempotencyKey: payment.idempotencyKey,
      requestHash: payment.requestHash,
      kind: payment.kind,
      reversesPaymentId: payment.reversesPaymentId ?? null,
    };
    await addDoc(this.collectionRef(), payload);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef(), id));
  }
}
