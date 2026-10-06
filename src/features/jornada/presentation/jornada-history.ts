/** Ordenação e datas do histórico exibido no painel. */
export interface JornadaHistoryRecord {
  status: 'open' | 'closed';
  dataInicioISO: string;
  horaInicioISO: string;
  dataFimISO: string | null;
  horaFimISO: string | null;
}

export function listJornadaHistory<T extends JornadaHistoryRecord>(records: T[]): T[] {
  return [...records].sort((a, b) => {
    const startA = `${a.dataInicioISO || ''}T${a.horaInicioISO || ''}`;
    const startB = `${b.dataInicioISO || ''}T${b.horaInicioISO || ''}`;
    return startB.localeCompare(startA);
  });
}

export function jornadaMoment(dateISO: string | null, timeISO: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO || '');
  if (!match) return 'Data não informada';
  const date = `${match[3]}/${match[2]}/${match[1]}`;
  return /^\d{2}:\d{2}$/.test(timeISO || '') ? `${date} às ${timeISO}` : date;
}