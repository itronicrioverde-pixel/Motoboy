import type { LocalSyncRecord } from '../application/pending-local-write';

export interface SyncBadge {
  kind: 'pending' | 'failure';
  text: string;
}

export function getSyncBadge(record: LocalSyncRecord | null | undefined): SyncBadge | null {
  if (!record || (record.fsId && record.syncState === 'saved')) return null;
  if (record.pendingCreateId) {
    if (record.syncState === 'pending') return { kind: 'pending', text: 'Sincronizando' };
    if (record.syncState === 'failed') return { kind: 'failure', text: 'Não confirmado' };
    return { kind: 'pending', text: 'Aguardando conexão' };
  }
  if (record.syncState === 'failed') return { kind: 'failure', text: 'Não salvo' };
  if (record.syncState === 'pending') return { kind: 'pending', text: 'Sincronizando' };
  return null;
}
