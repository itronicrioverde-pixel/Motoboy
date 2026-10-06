/** Criação financeira com identidade e payload preservados antes da primeira escrita. */

export type DurableCreateKind = 'abastecimentos' | 'manutencoes' | 'entradas';
export type DurableCreatePayload = Record<string, string | number | boolean | null>;

export interface DurableCreateAttempt {
  readonly uid: string;
  readonly kind: DurableCreateKind;
  readonly id: string;
  readonly payload: DurableCreatePayload;
}

export type DurableCreateResult = 'created' | 'already-applied' | 'removed';

export interface DurableCreateStore {
  list(uid: string): DurableCreateAttempt[];
  save(attempt: DurableCreateAttempt): void;
  clear(uid: string, kind: DurableCreateKind, id: string): void;
}

export interface DurableCreateGateway {
  commit(attempt: DurableCreateAttempt): Promise<DurableCreateResult>;
}

export interface DurableCreateManagerDependencies {
  readonly currentUid: () => string | null;
  readonly generateId: () => string;
  readonly now: () => number;
  readonly store: DurableCreateStore;
  readonly gateway: DurableCreateGateway;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

/** Valida também leituras do localStorage, que não são uma origem confiável. */
export function isDurableCreateAttempt(value: unknown): value is DurableCreateAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Record<string, unknown>;
  if (typeof attempt.uid !== 'string' || !attempt.uid) return false;
  if (typeof attempt.id !== 'string' || !ID_PATTERN.test(attempt.id)) return false;
  if (attempt.kind !== 'abastecimentos' && attempt.kind !== 'manutencoes' && attempt.kind !== 'entradas') return false;
  if (!attempt.payload || typeof attempt.payload !== 'object' || Array.isArray(attempt.payload)) return false;
  const payload = attempt.payload as Record<string, unknown>;
  const common = ['createAttemptId', 'createdAt', 'updatedAt', 'edited', 'editReason'];
  const featureKeys = attempt.kind === 'abastecimentos'
    ? ['dateISO', 'location', 'paidValue', 'pricePerLiter', 'liters', 'odometer']
    : attempt.kind === 'manutencoes'
      ? ['category', 'desc', 'valor', 'km', 'dateISO']
      : ['desc', 'valor', 'dateISO'];
  if (!exactKeys(payload, [...common, ...featureKeys])) return false;
  if (payload.createAttemptId !== attempt.id || payload.edited !== false || payload.editReason !== null) return false;
  if (typeof payload.createdAt !== 'number' || !Number.isFinite(payload.createdAt)) return false;
  if (payload.updatedAt !== payload.createdAt) return false;
  if (typeof payload.dateISO !== 'string' || !DATE_PATTERN.test(payload.dateISO)) return false;
  if (attempt.kind === 'abastecimentos') {
    return typeof payload.location === 'string' && Boolean(payload.location.trim())
      && typeof payload.paidValue === 'number' && Number.isFinite(payload.paidValue) && payload.paidValue > 0
      && typeof payload.pricePerLiter === 'number' && Number.isFinite(payload.pricePerLiter) && payload.pricePerLiter > 0
      && typeof payload.liters === 'number' && Number.isFinite(payload.liters) && payload.liters >= 0
      && (payload.odometer === null || (typeof payload.odometer === 'number' && Number.isFinite(payload.odometer) && payload.odometer >= 0));
  }
  if (attempt.kind === 'manutencoes') {
    return typeof payload.category === 'string' && Boolean(payload.category.trim())
      && typeof payload.desc === 'string' && Boolean(payload.desc.trim())
      && typeof payload.valor === 'number' && Number.isFinite(payload.valor) && payload.valor > 0
      && (payload.km === null || (typeof payload.km === 'number' && Number.isFinite(payload.km) && payload.km >= 0));
  }
  return typeof payload.desc === 'string' && Boolean(payload.desc.trim())
    && typeof payload.valor === 'number' && Number.isFinite(payload.valor) && payload.valor > 0;
}

export function createDurableCreateManager(deps: DurableCreateManagerDependencies) {
  const inFlight = new Map<string, Promise<DurableCreateResult>>();

  function requireUid(): string {
    const uid = deps.currentUid();
    if (!uid) throw new Error('Sem usuário autenticado para criar registro.');
    return uid;
  }

  function pending(kind: DurableCreateKind): DurableCreateAttempt[] {
    const uid = deps.currentUid();
    if (!uid) return [];
    return deps.store.list(uid).filter((attempt) => attempt.uid === uid && attempt.kind === kind);
  }

  function prepare(
    kind: DurableCreateKind,
    makePayload: (id: string, createdAt: number) => DurableCreatePayload,
  ): DurableCreateAttempt {
    const uid = requireUid();
    const id = deps.generateId();
    const createdAt = deps.now();
    const attempt = { uid, kind, id, payload: makePayload(id, createdAt) };
    if (!isDurableCreateAttempt(attempt)) throw new Error('Tentativa de criação inválida.');
    // Sem persistência local confirmada não há envio remoto: o retry perderia a identidade.
    deps.store.save(attempt);
    return attempt;
  }

  function retry(kind: DurableCreateKind, id: string): Promise<DurableCreateResult> {
    const uid = requireUid();
    const key = `${uid}:${kind}:${id}`;
    const running = inFlight.get(key);
    if (running) return running;
    const attempt = deps.store.list(uid).find((item) => item.uid === uid && item.kind === kind && item.id === id);
    if (!attempt || !isDurableCreateAttempt(attempt)) {
      return Promise.reject(new Error('Tentativa não confirmada não encontrada para este usuário.'));
    }
    const work = Promise.resolve()
      .then(() => deps.gateway.commit(attempt))
      .then((result) => {
        if (deps.currentUid() !== uid) {
          throw new Error('Sessão alterada; tentativa preservada para o usuário original.');
        }
        deps.store.clear(uid, kind, id);
        return result;
      })
      .finally(() => { if (inFlight.get(key) === work) inFlight.delete(key); });
    inFlight.set(key, work);
    return work;
  }

  return { prepare, pending, retry };
}
