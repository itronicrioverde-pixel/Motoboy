import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/firebase.js', () => ({ db: { _type: 'firestore' } }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  where: vi.fn(),
}));

import { jornadaFromSnapshot } from './firestore-jornada-repository';

interface FakeData {
  [key: string]: unknown;
}

function fakeSnapshot(id: string, data: FakeData) {
  return { id, data: () => data } as never;
}

describe('jornadaFromSnapshot — conversão segura do documento', () => {
  it('converte jornada em aberto com todos os campos', () => {
    const data = {
      status: 'open',
      kmInicial: 100,
      dataInicioISO: '2026-09-24',
      horaInicioISO: '08:00',
      kmFinal: null,
      dataFimISO: null,
      horaFimISO: null,
      consumoReferencia: null,
      origemConsumo: null,
      precoReferencia: null,
      origemPreco: null,
      custoEstimado: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const entity = jornadaFromSnapshot(fakeSnapshot('j1', data));
    expect(entity.id).toBe('j1');
    expect(entity.status).toBe('open');
    expect(entity.kmInicial).toBe(100);
    expect(entity.kmFinal).toBeNull();
  });

  it('converte jornada fechada com referências e custo estimado', () => {
    const entity = jornadaFromSnapshot(fakeSnapshot('j2', {
      status: 'closed',
      kmInicial: '10',
      dataInicioISO: '2026-09-24',
      horaInicioISO: '08:00',
      kmFinal: 145,
      dataFimISO: '2026-09-24',
      horaFimISO: '18:00',
      consumoReferencia: 20,
      origemConsumo: 'historico',
      precoReferencia: 6,
      origemPreco: 'abastecimento',
      custoEstimado: 40.5,
    }));
    expect(entity.status).toBe('closed');
    expect(entity.kmFinal).toBe(145);
    expect(entity.consumoReferencia).toBe(20);
    expect(entity.origemConsumo).toBe('historico');
    expect(entity.custoEstimado).toBe(40.5);
  });

  it('status desconhecido cai para open (default seguro)', () => {
    const entity = jornadaFromSnapshot(fakeSnapshot('j3', { status: 'whatever' }));
    expect(entity.status).toBe('open');
  });

  it('campos ausentes viram os defaults de segurança', () => {
    const entity = jornadaFromSnapshot(fakeSnapshot('j4', {}));
    expect(entity.kmInicial).toBe(0);
    expect(entity.dataInicioISO).toBe('');
    expect(entity.horaInicioISO).toBe('');
    expect(entity.kmFinal).toBeNull();
    expect(entity.custoEstimado).toBeNull();
    expect(entity.origemConsumo).toBeNull();
  });
});