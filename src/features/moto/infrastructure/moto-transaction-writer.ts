import { runTransaction } from 'firebase/firestore';
import type { DocumentReference } from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { MotoData } from '../domain/moto-data';

/** Preserva o maior hodômetro mesmo quando outro dispositivo envia um snapshot atrasado. */
export function persistMotoSnapshot(ref: DocumentReference, data: MotoData): Promise<MotoData> {
  if (!Number.isFinite(data.currentKm) || data.currentKm < 0
    || !Number.isFinite(data.consumption) || data.consumption < 0
    || typeof data.consumptionIsManual !== 'boolean') {
    throw new Error('Dados da moto inválidos.');
  }

  const snapshot = { ...data };
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    const storedKm = Number(current.data()?.currentKm);
    const next: MotoData = {
      ...snapshot,
      currentKm: Math.max(snapshot.currentKm, Number.isFinite(storedKm) ? storedKm : 0),
    };
    transaction.set(ref, next, { merge: true });
    return next;
  });
}

/**
 * Escritas de hodômetro/consumo calculado nunca confirmam um consumo manual.
 * A confirmação manual usa sua própria transação com marcador idempotente.
 */
export function persistMotoTelemetrySnapshot(ref: DocumentReference, data: MotoData): Promise<MotoData> {
  if (!Number.isFinite(data.currentKm) || data.currentKm < 0
    || !Number.isFinite(data.consumption) || data.consumption < 0
    || typeof data.consumptionIsManual !== 'boolean') {
    throw new Error('Dados da moto inválidos.');
  }
  const snapshot = { ...data };
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    const stored = current.data();
    const storedKm = Number(stored?.currentKm);
    const keepManual = Boolean(stored?.consumptionIsManual);
    const next: MotoData = {
      currentKm: Math.max(snapshot.currentKm, Number.isFinite(storedKm) ? storedKm : 0),
      consumption: keepManual || snapshot.consumptionIsManual
        ? Number(stored?.consumption) || 0
        : snapshot.consumption,
      consumptionIsManual: keepManual,
    };
    transaction.set(ref, next, { merge: true });
    return next;
  });
}
