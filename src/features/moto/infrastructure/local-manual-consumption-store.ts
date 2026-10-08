import {
  isManualConsumptionAttempt,
  type ManualConsumptionAttempt,
  type ManualConsumptionAttemptStore,
} from '../application/manual-consumption-attempt';

export interface ManualConsumptionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MANUAL_CONSUMPTION_KEY_PREFIX = 'motoboy.moto.manual-consumption.v1.';

export function manualConsumptionStorageKey(uid: string): string {
  return `${MANUAL_CONSUMPTION_KEY_PREFIX}${encodeURIComponent(uid).replaceAll('.', '%2E')}`;
}

export function createLocalManualConsumptionStore(storage: ManualConsumptionStorage): ManualConsumptionAttemptStore {
  function get(uid: string): ManualConsumptionAttempt | null {
    if (!uid) throw new Error('UID ausente.');
    const raw = storage.getItem(manualConsumptionStorageKey(uid));
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('Tentativa de consumo local corrompida.'); }
    if (!isManualConsumptionAttempt(value) || value.uid !== uid) {
      throw new Error('Tentativa de consumo local inválida.');
    }
    return value;
  }

  function put(attempt: ManualConsumptionAttempt): void {
    if (!isManualConsumptionAttempt(attempt)) throw new Error('Tentativa de consumo inválida.');
    const previous = get(attempt.uid);
    if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) {
      throw new Error('Já existe um consumo manual não confirmado.');
    }
    const key = manualConsumptionStorageKey(attempt.uid);
    const encoded = JSON.stringify(attempt);
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded) throw new Error('Tentativa de consumo não permaneceu gravada.');
  }

  function clear(attempt: ManualConsumptionAttempt): void {
    const existing = get(attempt.uid);
    if (!existing) return;
    if (JSON.stringify(existing) !== JSON.stringify(attempt)) return;
    const key = manualConsumptionStorageKey(attempt.uid);
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new Error('Tentativa confirmada não pôde ser removida.');
  }

  return { get, put, clear };
}
