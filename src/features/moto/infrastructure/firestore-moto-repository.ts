/**
 * Implementação Firestore do MotoRepository.
 *
 * Armazena em users/{uid}/moto/data (documento único por usuário).
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { MotoData, MotoRepository } from '../domain/moto-data';

const DEFAULT_MOTO_DATA: MotoData = {
  currentKm: 0,
  consumption: 0,
  consumptionIsManual: false,
};

export class FirestoreMotoRepository implements MotoRepository {
  constructor(private readonly getUid: () => string | null) {}

  private docRef() {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');
    return doc(db, 'users', uid, 'moto', 'data');
  }

  async get(): Promise<MotoData> {
    const snap = await getDoc(this.docRef());
    if (!snap.exists()) return DEFAULT_MOTO_DATA;
    const d = snap.data();
    return {
      currentKm: Number(d.currentKm) || 0,
      consumption: Number(d.consumption) || 0,
      consumptionIsManual: Boolean(d.consumptionIsManual),
    };
  }

  async save(data: MotoData): Promise<void> {
    await setDoc(this.docRef(), {
      currentKm: data.currentKm,
      consumption: data.consumption,
      consumptionIsManual: data.consumptionIsManual,
    }, { merge: true });
  }
}
