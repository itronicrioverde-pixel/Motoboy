import { mergeRemoteWithPending, type LocalSyncRecord } from '../../../shared/application/pending-local-write';

export interface JornadaViewRecord extends LocalSyncRecord {
  status: 'open' | 'closed';
  kmInicial: number;
  dataInicioISO: string;
  horaInicioISO: string;
}

function sameOpening(a: JornadaViewRecord, b: JornadaViewRecord): boolean {
  return a.kmInicial === b.kmInicial
    && a.dataInicioISO === b.dataInicioISO
    && a.horaInicioISO === b.horaInicioISO;
}

/** A carga do servidor vence tentativas não confirmadas que não podem mais abrir. */
export function mergeJornadaWithRemote<T extends JornadaViewRecord>(remote: T[], local: T[]): {
  items: T[];
  discardedFailedOpenCount: number;
} {
  const hasRemoteOpen = remote.some((item) => item.status === 'open');
  let discardedFailedOpenCount = 0;
  const remaining = local.filter((item) => {
    if (item.fsId || item.status !== 'open') return true;
    if (!hasRemoteOpen && !remote.some((saved) => sameOpening(saved, item))) return true;
    discardedFailedOpenCount += 1;
    return false;
  });
  return { items: mergeRemoteWithPending(remote, remaining), discardedFailedOpenCount };
}
