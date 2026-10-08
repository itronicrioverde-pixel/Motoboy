import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { MotoData } from '../domain/moto-data';
import {
  isManualConsumptionAttempt,
  type ManualConsumptionAttempt,
  type ManualConsumptionGateway,
} from '../application/manual-consumption-attempt';

/** Documento da moto e marcador de tentativa são confirmados no mesmo commit. */
export const firestoreManualConsumptionGateway: ManualConsumptionGateway<MotoData> = {
  apply(attempt: ManualConsumptionAttempt): Promise<MotoData> {
    if (!isManualConsumptionAttempt(attempt)) {
      return Promise.reject(new Error('Tentativa de consumo inválida.'));
    }
    const motoRef = doc(db, 'users', attempt.uid, 'moto', 'data');
    const markerRef = doc(db, 'users', attempt.uid, 'motoConsumptionAttempts', attempt.id);
    return runTransaction(db, async (transaction) => {
      const marker = await transaction.get(markerRef);
      const moto = await transaction.get(motoRef);
      const stored = moto.data();
      if (marker.exists()) {
        const applied = marker.data();
        if (applied.uid !== attempt.uid || applied.consumption !== attempt.consumption) {
          throw new Error('ID de consumo já usado com outros dados.');
        }
        return {
          currentKm: Number(stored?.currentKm) || 0,
          consumption: Number(stored?.consumption) || 0,
          consumptionIsManual: Boolean(stored?.consumptionIsManual),
        };
      }
      const next: MotoData = {
        currentKm: Number(stored?.currentKm) || 0,
        consumption: attempt.consumption,
        consumptionIsManual: true,
      };
      transaction.set(motoRef, next, { merge: true });
      transaction.set(markerRef, {
        uid: attempt.uid,
        consumption: attempt.consumption,
      });
      return next;
    });
  },
};
