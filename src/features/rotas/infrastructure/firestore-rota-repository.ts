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
} from '../domain/rota';
import {
  toNumber,
  toNumberOrNull,
  toRotaService,
} from './firestore-rota-mappers';

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
    services: Array.isArray(d.services) ? d.services.map(toRotaService) : [],
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
