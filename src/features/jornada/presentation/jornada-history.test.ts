import { describe, expect, it } from 'vitest';
import { jornadaMoment, listJornadaHistory } from './jornada-history';

describe('histórico de jornadas no painel', () => {
  it('mostra início e término como datas completas e mantém jornadas abertas', () => {
    const records = [
      { status: 'closed' as const, dataInicioISO: '2026-09-23', horaInicioISO: '07:30', dataFimISO: '2026-09-23', horaFimISO: '18:20' },
      { status: 'open' as const, dataInicioISO: '2026-09-25', horaInicioISO: '17:38', dataFimISO: null, horaFimISO: null },
      { status: 'closed' as const, dataInicioISO: '2026-09-24', horaInicioISO: '08:00', dataFimISO: '2026-09-24', horaFimISO: '19:15' },
    ];
    const ordered = listJornadaHistory(records);
    expect(ordered.map(j => jornadaMoment(j.dataInicioISO, j.horaInicioISO))).toEqual([
      '25/09/2026 às 17:38', '24/09/2026 às 08:00', '23/09/2026 às 07:30',
    ]);
    expect(ordered.map(j => j.status === 'open' ? 'Em andamento' : jornadaMoment(j.dataFimISO, j.horaFimISO))).toEqual([
      'Em andamento', '24/09/2026 às 19:15', '23/09/2026 às 18:20',
    ]);
    expect(records[0].dataInicioISO).toBe('2026-09-23');
  });

  it('preserva a data se a hora não foi registrada em uma jornada antiga', () => {
    expect(jornadaMoment('2026-09-24', null)).toBe('24/09/2026');
    expect(jornadaMoment(null, null)).toBe('Data não informada');
  });
});