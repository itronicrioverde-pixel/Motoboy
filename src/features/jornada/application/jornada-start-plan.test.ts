import { describe, it, expect, vi } from 'vitest';
import { jornadaStartPlan, type JornadaStartCandidate } from './jornada-start-plan';
import { settleLocalAdd, type LocalWriteStatus } from '../../../shared/application/pending-local-write';

/** Registro no formato mantido pelo painel (`jornadas`). */
interface OpenRecord extends JornadaStartCandidate {
  fsId: string | null;
  kmInicial: number;
  dataInicioISO: string;
  horaInicioISO: string;
  kmFinal: null;
  dataFimISO: null;
  horaFimISO: null;
  consumoReferencia: null;
  precoReferencia: null;
  custoEstimado: null;
  syncState: LocalWriteStatus;
}

function openRecord(overrides: Partial<OpenRecord> = {}): OpenRecord {
  return {
    fsId: null,
    status: 'open',
    kmInicial: 100,
    dataInicioISO: '2026-09-25',
    horaInicioISO: '08:00',
    kmFinal: null,
    dataFimISO: null,
    horaFimISO: null,
    consumoReferencia: null,
    precoReferencia: null,
    custoEstimado: null,
    syncState: 'failed',
    ...overrides,
  };
}

describe('jornadaStartPlan — retry reenvia a MESMA abertura, sem criar duplicata', () => {
  it('abertura falhada sem fsId vira retry do próprio registro', () => {
    const record = openRecord();
    const plan = jornadaStartPlan(record);
    expect(plan.action).toBe('retry');
    if (plan.action === 'retry') expect(plan.record).toBe(record);
  });

  it('abertura pendente sem fsId também é retry', () => {
    const record = openRecord({ syncState: 'pending' });
    expect(jornadaStartPlan(record).action).toBe('retry');
  });

  it('abertura já confirmada (com fsId) segue para o formulário de nova jornada', () => {
    const record = openRecord({ fsId: 'j-9', syncState: 'saved' });
    expect(jornadaStartPlan(record).action).toBe('form');
  });

  it('sem jornada em aberto, abre o formulário', () => {
    expect(jornadaStartPlan(null).action).toBe('form');
  });

  it('o retry usa o mesmo registro no settleLocalAdd e a lista local não duplica', async () => {
    const record = openRecord();
    const list = [record];
    const plan = jornadaStartPlan(record);
    expect(plan.action).toBe('retry');
    if (plan.action !== 'retry') return;
    const retried = plan.record as OpenRecord;
    const remoteAdd = vi.fn(async (r: OpenRecord) => (r.kmInicial === 100 ? 'j-42' : null));
    const onConfirmed = vi.fn();
    await settleLocalAdd(retried, remoteAdd, {
      isPresent: (r) => list.indexOf(r) !== -1,
      isSameOwner: () => true,
      onPersistenceConfirmed: (r, id) => { r.fsId = id; r.syncState = 'saved'; onConfirmed(id); },
      onPersistenceFailed: () => undefined,
      onOrphanRemoval: () => undefined,
      onSettled: () => undefined,
    });
    expect(list.length).toBe(1);
    expect(list[0].fsId).toBe('j-42');
    expect(list[0].syncState).toBe('saved');
    expect(remoteAdd).toHaveBeenCalledWith(retried);
    expect(remoteAdd).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith('j-42');
  });
});