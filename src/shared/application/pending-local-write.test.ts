import { describe, it, expect, vi } from 'vitest';
import {
  settleLocalAdd,
  runRemoteWrite,
  mergeRemoteWithPending,
  type LocalSyncRecord,
  type LocalWriteCallbacks,
  type LocalWriteStatus,
} from './pending-local-write';

type Record = LocalSyncRecord & { desc?: string };

function makeCallbacks(overrides: Partial<LocalWriteCallbacks<Record>> = {}) {
  const present = vi.fn(() => true);
  const sameOwner = vi.fn(() => true);
  const confirmed = vi.fn();
  const failed = vi.fn();
  const orphan = vi.fn();
  const settled = vi.fn();
  const callbacks: LocalWriteCallbacks<Record> = {
    isPresent: present,
    isSameOwner: sameOwner,
    onPersistenceConfirmed: confirmed,
    onPersistenceFailed: failed,
    onOrphanRemoval: orphan,
    onSettled: settled,
    ...overrides,
  };
  return { callbacks, present, sameOwner, confirmed, failed, orphan, settled };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('settleLocalAdd — salvo / pendente / falhou', () => {
  it('confirma "salvo" com o id remoto e libera o lock', async () => {
    const { callbacks, confirmed, settled } = makeCallbacks();
    const record: Record = { fsId: null };
    const remoteAdd = vi.fn(async () => 'ref-A1');
    await settleLocalAdd(record, remoteAdd, callbacks);

    expect(record.syncState).toBe('saved');
    expect(record.fsId).toBe('ref-A1');
    expect(confirmed).toHaveBeenCalledWith(record, 'ref-A1');
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('marca "failed" quando o remoto rejeita (falha de rede)', async () => {
    const { callbacks, failed, settled } = makeCallbacks();
    const record: Record = {};
    const networkError = new Error('offline');
    const remoteAdd = vi.fn(async () => { throw networkError; });
    await settleLocalAdd(record, remoteAdd, callbacks);

    expect(record.syncState).toBe('failed');
    expect(record.fsId).toBeUndefined();
    expect(failed).toHaveBeenCalledWith(record, networkError);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('marca "failed" quando o id remoto é nulo/vazio (add sem confirmação)', async () => {
    const { callbacks, failed, confirmed } = makeCallbacks();
    const record: Record = {};
    await settleLocalAdd(record, vi.fn(async () => null), callbacks);

    expect(record.syncState).toBe('failed');
    expect(confirmed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalled();
  });

  it('fica "pending" e não falha quando não há ponte remota', async () => {
    const { callbacks, failed, settled } = makeCallbacks();
    const record: Record = {};
    await settleLocalAdd(record, undefined, callbacks);

    expect(record.syncState).toBe('pending');
    expect(failed).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('conclusão controlada: nada é confirmado antes da resolução (promessa pendente)', async () => {
    const { callbacks, confirmed } = makeCallbacks();
    const record: Record = {};
    const { promise, resolve } = deferred<string | null>();
    const call = settleLocalAdd(record, () => promise, callbacks);
    await Promise.resolve();
    expect(record.syncState).toBe('pending');
    expect(confirmed).not.toHaveBeenCalled();

    resolve('ref-late');
    await call;
    expect(record.syncState).toBe('saved');
    expect(confirmed).toHaveBeenCalled();
  });
});

describe('settleLocalAdd — exclusão durante criação pendente e troca de UID', () => {
  it('limpa o órfão remoto quando o id chega depois da exclusão local', async () => {
    const present = vi.fn(() => false);
    const { callbacks, orphan, confirmed } = makeCallbacks({ isPresent: present });
    const record: Record = {};
    await settleLocalAdd(record, () => Promise.resolve('ref-orphan'), callbacks);

    expect(orphan).toHaveBeenCalledWith('ref-orphan');
    expect(confirmed).not.toHaveBeenCalled();
    expect(record.fsId).toBeUndefined();
  });

  it('exclusão durante criação pendente sem id remoto não faz nada de remoto', async () => {
    const present = vi.fn(() => false);
    const { callbacks, orphan } = makeCallbacks({ isPresent: present });
    await settleLocalAdd({}, () => Promise.resolve(null), callbacks);
    expect(orphan).not.toHaveBeenCalled();
  });

  it('troca de UID no meio da escrita descarta a conclusão local', async () => {
    const { callbacks, confirmed, failed } = makeCallbacks({
      isSameOwner: () => false,
    });
    const record: Record = {};
    await settleLocalAdd(record, () => Promise.resolve('ref-x'), callbacks);

    expect(confirmed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(record.fsId).toBeUndefined();
    expect(record.syncState).toBe('pending');
  });

  it('troca de UID com falha não aplica "failed" ao registro', async () => {
    const { callbacks, failed } = makeCallbacks({ isSameOwner: () => false });
    const record: Record = {};
    await settleLocalAdd(record, () => Promise.reject(new Error('boom')), callbacks);
    expect(failed).not.toHaveBeenCalled();
    expect(record.syncState).toBe('pending');
  });
});

describe('runRemoteWrite — update/remove aguardando confirmação', () => {
  it('retorna true e não altera estado se o remoto confirmar', async () => {
    const { callbacks } = makeCallbacks();
    const ok = await runRemoteWrite({ fsId: 'a', syncState: 'saved' }, () => Promise.resolve(), callbacks);
    expect(ok).toBe(true);
  });

  it('retorna false e chama onPersistenceFailed quando o remoto falha', async () => {
    const failed = vi.fn();
    const settled = vi.fn();
    const record: Record = { fsId: 'a' };
    const error = new Error('rede caiu');
    const ok = await runRemoteWrite(
      record,
      () => Promise.reject(error),
      { isSameOwner: () => true, onPersistenceFailed: failed, onSettled: settled },
    );
    expect(ok).toBe(false);
    expect(failed).toHaveBeenCalledWith(record, error);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('retorna false e falha ao não haver ponte (libera o lock)', async () => {
    const failed = vi.fn();
    const settled = vi.fn();
    const record: Record = {};
    const ok = await runRemoteWrite(record, undefined, {
      isSameOwner: () => true,
      onPersistenceFailed: failed,
      onSettled: settled,
    });
    expect(ok).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('não aplica sucesso se o UID mudou no meio da escrita', async () => {
    const ok = await runRemoteWrite({}, () => Promise.resolve(), {
      isSameOwner: () => false,
      onPersistenceFailed: () => {},
      onSettled: () => {},
    });
    expect(ok).toBe(false);
  });
});

describe('mergeRemoteWithPending — recarga não apaga escrita pendente', () => {
  type Veiculo = { fsId?: string | null; syncState: LocalWriteStatus; desc?: string };
  const remote = (fsId: string): Veiculo => ({ fsId, syncState: 'saved' });

  it('preserva registros locais sem id remoto (pendente/falhou) após uma recarga', () => {
    const merged = mergeRemoteWithPending<Veiculo>(
      [remote('r1'), remote('r2')],
      [
        { fsId: undefined, desc: 'pendente 1', syncState: 'pending' },
        { fsId: null, desc: 'falhou 1', syncState: 'failed' },
      ],
    );
    expect(merged).toHaveLength(4);
    expect(merged.some((r) => r.desc === 'pendente 1')).toBe(true);
    expect(merged.some((r) => r.desc === 'falhou 1')).toBe(true);
  });

  it('registros remotos sempre vencem os locais com o mesmo fsId', () => {
    const merged = mergeRemoteWithPending<Veiculo>(
      [remote('r1')],
      [{ fsId: 'r1', desc: 'cópia local antiga', syncState: 'saved' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].desc).toBeUndefined();
    expect(merged[0].fsId).toBe('r1');
  });

  it('carga remota vazia não apaga as pendências locais', () => {
    const merged = mergeRemoteWithPending<Veiculo>([], [{ fsId: null, syncState: 'failed' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].syncState).toBe('failed');
  });

  it('não preserva registros locais confirmados fora do remoto (removidos em outro aparelho)', () => {
    const merged = mergeRemoteWithPending<Veiculo>([], [{ fsId: 'gone', syncState: 'saved' }]);
    expect(merged).toHaveLength(0);
  });
});