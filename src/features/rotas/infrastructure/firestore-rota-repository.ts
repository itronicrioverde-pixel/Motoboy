/**
 * Implementação Firestore do RotaRepository (infraestrutura).
 * Guarda cada rota em users/{uid}/rotas, usando o id da rota como id do doc.
 */

import {
  collection,
  doc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type {
  Rota,
  RotaRepository,
  RotaService,
  RotaEntrega,
} from '../domain/rota';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toEntrega(raw: DocumentData): RotaEntrega {
  return {
    endereco: String(raw?.endereco ?? ''),
    valor: toNumber(raw?.valor),
    distancia: toNumberOrNull(raw?.distancia),
    tempo: toNumberOrNull(raw?.tempo),
    aproximada: Boolean(raw?.aproximada),
  };
}
function toService(raw: DocumentData): RotaService {
  return {
    coleta: String(raw?.coleta ?? ''),
    cliente: String(raw?.cliente ?? ''),
    paymentStatus: String(raw?.paymentStatus ?? ''),
    valorTotal: toNumber(raw?.valorTotal),
    entregas: Array.isArray(raw?.entregas) ? raw.entregas.map(toEntrega) : [],
  };
}

function toEntity(snapshot: QueryDocumentSnapshot<DocumentData>): Rota {
  const d = snapshot.data();
  return {
    id: snapshot.id,
    count: toNumber(d.count),
    distancia: toNumber(d.distancia),
    tempoMin: toNumber(d.tempoMin),
    valorTotal: toNumber(d.valorTotal),
    custoCombustivel: toNumberOrNull(d.custoCombustivel),
    resultado: toNumberOrNull(d.resultado),
    recebidoNaHora: toNumber(d.recebidoNaHora),
    pendente: toNumber(d.pendente),
    data: String(d.data ?? ''),
    dateISO: String(d.dateISO ?? ''),
    hora: String(d.hora ?? ''),
    createdAt: String(d.createdAt ?? ''),
    consumoKmL: toNumber(d.consumoKmL),
    precoLitro: toNumber(d.precoLitro),
    aproximada: Boolean(d.aproximada),
    services: Array.isArray(d.services) ? d.services.map(toService) : [],
    status: d.status === 'pending' ? 'pending' : 'confirmed',
  };
}

export class FirestoreRotaRepository implements RotaRepository {
  constructor(private readonly getUid: () => string | null) {}

  private collectionRef(): CollectionReference<DocumentData> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return collection(db, 'users', uid, 'rotas');
  }

  async list(): Promise<Rota[]> {
    const snap = await getDocs(query(this.collectionRef(), orderBy('dateISO', 'desc')));
    return snap.docs.map(toEntity);
  }

  observe(callback: (items: Rota[]) => void): () => void {
    return onSnapshot(query(this.collectionRef(), orderBy('dateISO', 'desc')), (snap) => {
      callback(snap.docs.map(toEntity));
    });
  }

  async save(rota: Rota): Promise<void> {
    const ref = doc(this.collectionRef(), rota.id);
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if(existing.exists()){
        const data = existing.data();
        if(rota.status === 'pending' && data.status === 'confirmed'){
          throw new Error(`Rota ${rota.id} já está confirmada — não pode voltar para pending.`);
        }
      }
      tx.set(ref, rota);
    });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.collectionRef(), id));
  }
}
