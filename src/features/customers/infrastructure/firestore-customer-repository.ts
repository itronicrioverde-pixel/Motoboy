/**
 * Implementação Firestore do CustomerRepository (infraestrutura).
 * Guarda cada cliente em users/{uid}/customers, isolado por dono.
 */

import {
  collection,
  addDoc,
  updateDoc,
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
import type {
  Customer,
  CustomerRepository,
  CreateCustomerInput,
  UpdateCustomerInput,
} from '../domain/customer';

function toEntity(snapshot: QueryDocumentSnapshot<DocumentData>): Customer {
  const d = snapshot.data();
  return {
    id: snapshot.id,
    name: String(d.name ?? ''),
    phone: d.phone ? String(d.phone) : undefined,
    nickname: d.nickname ? String(d.nickname) : undefined,
    notes: d.notes ? String(d.notes) : undefined,
    status: d.status === 'archived' ? 'archived' : 'active',
  };
}

export class FirestoreCustomerRepository implements CustomerRepository {
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'customers');
  }

  async list(): Promise<Customer[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('name', 'asc')));
    return snap.docs.map(toEntity);
  }

  observe(callback: (items: Customer[]) => void): () => void {
    return onSnapshot(query(this.collectionRef(), orderBy('name', 'asc')), (snap) => {
      callback(snap.docs.map(toEntity));
    });
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    const payload = {
      name: input.name,
      phone: input.phone ?? null,
      nickname: input.nickname ?? null,
      notes: input.notes ?? null,
      status: 'active' as const,
    };
    const ref = await addDoc(this.collectionRef(), payload);
    return {
      id: ref.id,
      name: payload.name,
      phone: payload.phone ?? undefined,
      nickname: payload.nickname ?? undefined,
      notes: payload.notes ?? undefined,
      status: payload.status,
    };
  }

  async update(id: string, input: UpdateCustomerInput): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone ?? null;
    if (input.nickname !== undefined) patch.nickname = input.nickname ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (Object.keys(patch).length > 0) {
      await updateDoc(doc(this.collectionRef(), id), patch);
    }
  }

  async archive(id: string): Promise<void> {
    await updateDoc(doc(this.collectionRef(), id), { status: 'archived' });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef(), id));
  }
}
