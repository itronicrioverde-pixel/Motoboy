/**
 * Implementação Firestore do JornadaRepository (camada de infraestrutura).
 *
 * Guarda cada jornada em users/{uid}/jornadas, isolado por dono (as rules
 * vigentes já liberam a subárvore users/{uid} para o próprio usuário — não há
 * mudança de regras). O domínio não sabe que isto existe.
 */

import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type {
  ConsumoOrigem,
  Jornada,
  JornadaClosePatch,
  JornadaRepository,
  NewJornada,
  PrecoOrigem,
} from '../domain/jornada';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Converte um snapshot em entidade (exportado para teste isolado). */
export function jornadaFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Jornada {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    status: data.status === 'closed' ? 'closed' : 'open',
    kmInicial: toNumber(data.kmInicial),
    dataInicioISO: String(data.dataInicioISO ?? ''),
    horaInicioISO: String(data.horaInicioISO ?? ''),
    kmFinal: toNullableNumber(data.kmFinal),
    dataFimISO: data.dataFimISO ? String(data.dataFimISO) : null,
    horaFimISO: data.horaFimISO ? String(data.horaFimISO) : null,
    consumoReferencia: toNullableNumber(data.consumoReferencia),
    origemConsumo: (typeof data.origemConsumo === 'string' ? data.origemConsumo : null) as ConsumoOrigem | null,
    precoReferencia: toNullableNumber(data.precoReferencia),
    origemPreco: (typeof data.origemPreco === 'string' ? data.origemPreco : null) as PrecoOrigem | null,
    custoEstimado: toNullableNumber(data.custoEstimado),
    createdAt: toNumber(data.createdAt, Date.now()),
    updatedAt: toNumber(data.updatedAt, Date.now()),
  };
}

export class FirestoreJornadaRepository implements JornadaRepository {
  /** getUid é injetado para nunca gravar no dono errado. */
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'jornadas');
  }

  async list(): Promise<Jornada[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('dataInicioISO', 'desc')));
    return snap.docs.map(jornadaFromSnapshot);
  }

  async findOpen(): Promise<Jornada | null> {
    const snap = await getDocs(
      query(this.collectionRef(), where('status', '==', 'open'), limit(1)),
    );
    if (snap.empty) return null;
    return jornadaFromSnapshot(snap.docs[0]);
  }

  async add(data: NewJornada): Promise<Jornada> {
    const now = Date.now();
    const payload = {
      status: 'open' as const,
      kmInicial: data.kmInicial,
      dataInicioISO: data.dataInicioISO,
      horaInicioISO: data.horaInicioISO,
      kmFinal: null,
      dataFimISO: null,
      horaFimISO: null,
      consumoReferencia: null,
      origemConsumo: null,
      precoReferencia: null,
      origemPreco: null,
      custoEstimado: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(this.collectionRef(), payload);
    return { id: ref.id, ...payload };
  }

  async close(id: string, patch: JornadaClosePatch): Promise<void> {
    await updateDoc(doc(this.collectionRef(), id), {
      status: 'closed',
      kmFinal: patch.kmFinal,
      dataFimISO: patch.dataFimISO,
      horaFimISO: patch.horaFimISO,
      consumoReferencia: patch.consumoReferencia,
      origemConsumo: patch.origemConsumo,
      precoReferencia: patch.precoReferencia,
      origemPreco: patch.origemPreco,
      custoEstimado: patch.custoEstimado,
      updatedAt: patch.updatedAt,
    });
  }
}