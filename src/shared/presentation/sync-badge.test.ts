import { describe, expect, it } from 'vitest';
import { getSyncBadge } from './sync-badge';

describe('indicador de confirmação do painel', () => {
  it('não mostra pendência para registro já confirmado, mesmo se o ID local ainda existir', () => {
    expect(getSyncBadge({ fsId: 'j1_123', pendingCreateId: 'j1_123', syncState: 'saved' })).toBeNull();
  });

  it('mantém estados visíveis para tentativas sem confirmação', () => {
    expect(getSyncBadge({ pendingCreateId: 'j1_123', syncState: 'pending' }))
      .toEqual({ kind: 'pending', text: 'Sincronizando' });
    expect(getSyncBadge({ pendingCreateId: 'j1_123', syncState: 'awaiting' }))
      .toEqual({ kind: 'pending', text: 'Aguardando conexão' });
    expect(getSyncBadge({ pendingCreateId: 'j1_123', syncState: 'failed' }))
      .toEqual({ kind: 'failure', text: 'Não confirmado' });
    expect(getSyncBadge({ syncState: 'failed' }))
      .toEqual({ kind: 'failure', text: 'Não salvo' });
  });
});
