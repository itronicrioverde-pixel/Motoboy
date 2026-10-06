import { describe, expect, it } from 'vitest';
import { mergeJornadaWithRemote, type JornadaViewRecord } from './jornada-merge';

const saved: JornadaViewRecord = {
  fsId: 'remote', status: 'open', kmInicial: 1001,
  dataInicioISO: '2026-09-30', horaInicioISO: '08:00', syncState: 'saved',
};
const failed: JornadaViewRecord = {
  fsId: null, status: 'open', kmInicial: 1000,
  dataInicioISO: '2026-09-30', horaInicioISO: '08:00', syncState: 'failed',
};

describe('mescla de jornada após conflito entre abas', () => {
  it('remove início rejeitado quando o servidor já possui outra jornada aberta', () => {
    expect(mergeJornadaWithRemote<JornadaViewRecord>([saved], [failed])).toEqual({
      items: [saved], discardedFailedOpenCount: 1,
    });
  });

  it('reconcilia resposta perdida mesmo se a jornada remota já foi fechada', () => {
    const closed: JornadaViewRecord = { ...saved, status: 'closed', kmInicial: 1000 };
    expect(mergeJornadaWithRemote<JornadaViewRecord>([closed], [failed])).toEqual({
      items: [closed], discardedFailedOpenCount: 1,
    });
  });

  it('preserva falha offline sem correspondente remoto e escrita ainda em voo', () => {
    expect(mergeJornadaWithRemote<JornadaViewRecord>([], [failed]).items).toEqual([failed]);
    const pending: JornadaViewRecord = { ...failed, syncState: 'pending' };
    expect(mergeJornadaWithRemote<JornadaViewRecord>([saved], [pending])).toEqual({
      items: [saved], discardedFailedOpenCount: 1,
    });
  });

  it('descarta tentativa ainda pendente quando a resposta perdida já foi encerrada', () => {
    const pending: JornadaViewRecord = { ...failed, syncState: 'pending' };
    const closed: JornadaViewRecord = { ...saved, status: 'closed', kmInicial: 1000 };
    expect(mergeJornadaWithRemote<JornadaViewRecord>([closed], [pending]).items).toEqual([closed]);
  });
});
