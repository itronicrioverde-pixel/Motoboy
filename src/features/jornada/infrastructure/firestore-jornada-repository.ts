/**
 * Implementação Firestore do JornadaRepository (camada de infraestrutura).
 *
 * Guarda cada jornada em users/{uid}/jornadas, isolado por dono (as rules
 * vigentes já liberam a subárvore users/{uid} para o próprio usuário — não há
 * mudança de regras). O domínio não sabe que isto existe.
 */

import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  query,
  runTransaction,
  orderBy,
  limit,
  where,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import { JornadaAlreadyOpenError, JornadaValidationError } from '../application/jornada-service';
import { jornadaOpeningId } from '../application/jornada-opening-id';
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

function sameOpening(jornada: Jornada, data: NewJornada): boolean {
  return jornada.kmInicial === data.kmInicial
    && jornada.dataInicioISO === data.dataInicioISO
    && jornada.horaInicioISO === data.horaInicioISO;
}

export class FirestoreJornadaRepository implements JornadaRepository {
  /** getUid é injetado para nunca gravar no dono errado. */
  constructor(private readonly getUid: () => string | null) {}

  private requireUid(): string {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return uid;
  }

  private collectionRef(uid = this.requireUid()): CollectionReference<DocumentData> {
    return collection(db, 'users', uid, 'jornadas');
  }

  async list(): Promise<Jornada[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('dataInicioISO', 'desc')));
    return snap.docs.map(jornadaFromSnapshot);
  }

  async findOpen(): Promise<Jornada | null> {
    const snap = await getDocsFromServer(
      query(this.collectionRef(), where('status', '==', 'open'), limit(1)),
    );
    if (snap.empty) return null;
    return jornadaFromSnapshot(snap.docs[0]);
  }

  async add(data: NewJornada): Promise<Jornada> {
    const uid = this.requireUid();
    const id = jornadaOpeningId(data);
    const ref = doc(this.collectionRef(uid), id);
    // Coleções anteriores à trava continuam válidas. Uma leitura do servidor
    // impede abrir outra jornada enquanto uma delas ainda estiver em aberto.
    const legacyOpen = await getDocsFromServer(
      query(this.collectionRef(uid), where('status', '==', 'open'), limit(1)),
    );
    if (!legacyOpen.empty) {
      const existing = jornadaFromSnapshot(legacyOpen.docs[0]);
      if (sameOpening(existing, data)) return existing;
      throw new JornadaAlreadyOpenError();
    }
    // O ID das versões anteriores era aleatório. Reconhece também uma
    // abertura legada já fechada antes de tentar criar seu sucessor.
    const sameDay = await getDocsFromServer(
      query(this.collectionRef(uid), where('dataInicioISO', '==', data.dataInicioISO)),
    );
    const legacyMatch = sameDay.docs
      .filter((snapshot) => snapshot.id !== id)
      .map(jornadaFromSnapshot)
      .find((jornada) => sameOpening(jornada, data));
    if (legacyMatch) return legacyMatch;
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
    const stateRef = doc(db, 'users', uid, 'jornadaState', 'current');
    return runTransaction(db, async (tx) => {
      const state = await tx.get(stateRef);
      const attempted = await tx.get(ref);
      if (attempted.exists()) {
        const existing = jornadaFromSnapshot(attempted);
        if (!sameOpening(existing, data)) {
          throw new JornadaValidationError('Identidade da jornada em conflito; nenhuma abertura foi gravada.');
        }
        return existing;
      }
      const activeId = state.exists() ? state.data().activeJornadaId : null;
      if (activeId !== null && activeId !== undefined) {
        if (typeof activeId !== 'string' || !/^(?:[A-Za-z0-9]{20}|j1_(?:[a-f0-9]{2}){1,500})$/.test(activeId)) {
          throw new JornadaValidationError('Controle da jornada inválido; nenhuma abertura foi gravada.');
        }
        const active = await tx.get(doc(this.collectionRef(uid), activeId));
        if (active.exists() && active.data().status === 'open') {
          const existing = jornadaFromSnapshot(active);
          if (sameOpening(existing, data)) return existing;
          throw new JornadaAlreadyOpenError();
        }
      }
      tx.set(ref, payload);
      tx.set(stateRef, { activeJornadaId: ref.id, updatedAt: now });
      return { id: ref.id, ...payload };
    });
  }

  async close(id: string, patch: JornadaClosePatch): Promise<Jornada> {
    const uid = this.requireUid();
    const ref = doc(this.collectionRef(uid), id);
    const stateRef = doc(db, 'users', uid, 'jornadaState', 'current');
    return runTransaction(db, async (tx) => {
      const currentSnapshot = await tx.get(ref);
      if (!currentSnapshot.exists()) throw new JornadaValidationError('Jornada não encontrada.');
      const current = jornadaFromSnapshot(currentSnapshot);
      if (current.status === 'closed') return current;
      const state = await tx.get(stateRef);
      tx.update(ref, { status: 'closed', ...patch });
      if (state.exists() && state.data().activeJornadaId === id) {
        tx.set(stateRef, { activeJornadaId: null, updatedAt: patch.updatedAt });
      }
      return { ...current, status: 'closed', ...patch };
    });
  }
}
