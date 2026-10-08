export interface ManualConsumptionAttempt {
  readonly id: string;
  readonly uid: string;
  readonly consumption: number;
}

export interface ManualConsumptionAttemptStore {
  get(uid: string): ManualConsumptionAttempt | null;
  put(attempt: ManualConsumptionAttempt): void;
  clear(attempt: ManualConsumptionAttempt): void;
}

export interface ManualConsumptionGateway<Result> {
  apply(attempt: ManualConsumptionAttempt): Promise<Result>;
}

export function isManualConsumptionAttempt(value: unknown): value is ManualConsumptionAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attempt = value as Record<string, unknown>;
  return Object.keys(attempt).sort().join(',') === 'consumption,id,uid'
    && typeof attempt.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(attempt.id)
    && typeof attempt.uid === 'string' && attempt.uid.length > 0
    && typeof attempt.consumption === 'number'
    && Number.isFinite(attempt.consumption) && attempt.consumption > 0;
}

/** Uma tentativa por UID. A identidade e o payload nunca mudam durante retry. */
export function createManualConsumptionManager<Result>(
  store: ManualConsumptionAttemptStore,
  gateway: ManualConsumptionGateway<Result>,
  makeId: () => string,
) {
  const inFlight = new Map<string, Promise<Result>>();

  function prepare(uid: string, consumption: number): ManualConsumptionAttempt {
    if (!uid || !Number.isFinite(consumption) || consumption <= 0) {
      throw new Error('Consumo manual ou sessão inválidos.');
    }
    const existing = store.get(uid);
    if (existing) {
      if (existing.consumption !== consumption) {
        throw new Error('Confirme primeiro o consumo anterior ou tente novamente.');
      }
      return existing;
    }
    const attempt = { id: makeId(), uid, consumption };
    store.put(attempt);
    return attempt;
  }

  function retry(uid: string): Promise<Result> {
    const running = inFlight.get(uid);
    if (running) return running;
    let attempt: ManualConsumptionAttempt | null;
    try { attempt = store.get(uid); }
    catch (error) { return Promise.reject(error); }
    if (!attempt) return Promise.reject(new Error('Não há consumo manual pendente.'));
    const operation = Promise.resolve().then(() => gateway.apply(attempt)).then((result) => {
      store.clear(attempt);
      return result;
    }).finally(() => {
      if (inFlight.get(uid) === operation) inFlight.delete(uid);
    });
    inFlight.set(uid, operation);
    return operation;
  }

  return { get: (uid: string) => store.get(uid), prepare, retry };
}
