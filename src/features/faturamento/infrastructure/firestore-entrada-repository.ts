/**
 * Implementação Firestore do EntradaRepository (infraestrutura).
 * Guarda cada entrada manual em users/{uid}/entradas, isolada por dono.
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
  Entrada,
  EntradaRepository,
  EditEntrada,
  NewEntrada,
} from '../domain/entrada';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s ? s : null;
}

/**
 * Converte um snapshot em Entrada preservando a identidade de recebimento.
 *
 * - Documentos de recebimento são gravados com o doc id igual a receiptOperationId
 *   e com os campos source/clientId/clientName. Recebimentos legados (anteriores ao
 *   campo receiptOperationId) são reconhecidos por source === 'client_receipt' e
 *   convertem o ID do documento em receiptOperationId.
 * - Entradas manuais não têm identidade de recebimento (campos ficam ausentes).
 */
export function entradaFromSnapshot(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): Entrada {
  const data = snapshot.data();
  const isReceipt =
    data.source === 'client_receipt' || data.receiptOperationId != null;
  return {
    id: snapshot.id,
    desc: String(data.desc ?? ''),
    valor: toNumber(data.valor),
    dateISO: String(data.dateISO ?? ''),
    edited: Boolean(data.edited),
    editReason: data.editReason ? String(data.editReason) : null,
    createdAt: toNumber(data.createdAt, Date.now()),
    updatedAt: toNumber(data.updatedAt, Date.now()),
    receiptOperationId: isReceipt
      ? String(data.receiptOperationId != null ? data.receiptOperationId : snapshot.id)
      : undefined,
    source: optionalString(data.source),
    clientId: optionalString(data.clientId),
    clientName: optionalString(data.clientName),
  };
}

export class FirestoreEntradaRepository implements EntradaRepository {
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'entradas');
  }

  async list(): Promise<Entrada[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('dateISO', 'desc')));
    return snap.docs.map(entradaFromSnapshot);
  }

  observe(callback: (items: Entrada[]) => void): () => void {
    return onSnapshot(query(this.collectionRef(), orderBy('dateISO', 'desc')), (snap) => {
      callback(snap.docs.map(entradaFromSnapshot));
    });
  }

  async add(data: NewEntrada): Promise<Entrada> {
    const now = Date.now();
    const payload = {
      desc: data.desc,
      valor: data.valor,
      dateISO: data.dateISO,
      edited: false,
      editReason: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(this.collectionRef(), payload);
    return { id: ref.id, ...payload };
  }

  async update(id: string, data: EditEntrada): Promise<void> {
    const patch: Record<string, unknown> = { edited: true, updatedAt: Date.now() };
    if (data.desc !== undefined) patch.desc = data.desc;
    if (data.valor !== undefined) patch.valor = data.valor;
    if (data.dateISO !== undefined) patch.dateISO = data.dateISO;
    if (data.editReason !== undefined) patch.editReason = data.editReason;
    await updateDoc(doc(this.collectionRef(), id), patch);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef(), id));
  }
}
