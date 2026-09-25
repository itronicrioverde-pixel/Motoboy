import { describe, it, expect, vi } from 'vitest';
import { JornadaService, JornadaValidationError } from './jornada-service';
import type { Jornada, JornadaRepository } from '../domain/jornada';

function makeJornada(overrides: Partial<Jornada> = {}): Jornada {
  return {
    id: 'j1',
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
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<JornadaRepository> = {}): JornadaRepository {
  return {
    list: vi.fn(async () => []),
    findOpen: vi.fn(async () => null),
    add: vi.fn(async (data) => makeJornada({ ...data })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('JornadaService.start — no máximo uma jornada em aberto', () => {
  it('abre a primeira jornada do usuário', async () => {
    const repo = fakeRepo();
    const service = new JornadaService(repo);
    const jornada = await service.start({ kmInicial: 10, dataInicioISO: '2026-09-24', horaInicioISO: '08:00' });
    expect(jornada.status).toBe('open');
    expect(jornada.kmInicial).toBe(10);
    expect(repo.add).toHaveBeenCalledOnce();
  });

  it('rejeita abrir quando já existe uma em aberto', async () => {
    const repo = fakeRepo({ findOpen: vi.fn(async () => makeJornada()) });
    const service = new JornadaService(repo);
    await expect(service.start({ kmInicial: 10, dataInicioISO: '2026-09-24', horaInicioISO: '08:00' }))
      .rejects.toBeInstanceOf(JornadaValidationError);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('devolve a abertura existente após resposta perdida, sem criar duplicata', async () => {
    const existing = makeJornada();
    const repo = fakeRepo({ findOpen: vi.fn(async () => existing) });
    const result = await new JornadaService(repo).start({ kmInicial: 100, dataInicioISO: '2026-09-24', horaInicioISO: '08:00' });
    expect(result).toBe(existing);
    expect(repo.add).not.toHaveBeenCalled();
  });

  it('rejeita km inicial inválido', async () => {
    const service = new JornadaService(fakeRepo());
    await expect(service.start({ kmInicial: -1, dataInicioISO: '2026-09-24', horaInicioISO: '08:00' }))
      .rejects.toThrow('km inicial');
  });
});

describe('JornadaService.close — valida fetas e custo estimado', () => {
  it('fecha uma jornada em aberto e calcula o custo estimado', async () => {
    const repo = fakeRepo({ list: vi.fn(async () => [makeJornada()]) });
    const service = new JornadaService(repo);
    const fechada = await service.close('j1', {
      kmFinal: 200,
      dataFimISO: '2026-09-24',
      horaFimISO: '18:00',
      consumoReferencia: 20,
      origemConsumo: 'historico',
      precoReferencia: 6,
      origemPreco: 'abastecimento',
    });
    expect(fechada.status).toBe('closed');
    expect(fechada.kmFinal).toBe(200);
    expect(fechada.custoEstimado).toBe(30);
    expect(repo.close).toHaveBeenCalledOnce();
  });

  it('sem referências de consumo/preço o custo fica null (e ninguém lança despesa)', async () => {
    const repo = fakeRepo({ list: vi.fn(async () => [makeJornada()]) });
    const service = new JornadaService(repo);
    const fechada = await service.close('j1', { kmFinal: 200, dataFimISO: '2026-09-24' });
    expect(fechada.custoEstimado).toBeNull();
    expect(fechada.consumoReferencia).toBeNull();
  });

  it('km final menor que o inicial é rejeitado', async () => {
    const repo = fakeRepo({ list: vi.fn(async () => [makeJornada({ kmInicial: 500 })]) });
    const service = new JornadaService(repo);
    await expect(service.close('j1', { kmFinal: 300, dataFimISO: '2026-09-24' }))
      .rejects.toThrow('menor que o km inicial');
  });

  it('fim antes do início é rejeitado', async () => {
    const repo = fakeRepo({
      list: vi.fn(async () => [
        makeJornada({ dataInicioISO: '2026-09-25', horaInicioISO: '08:00' }),
      ]),
    });
    const service = new JornadaService(repo);
    await expect(service.close('j1', { kmFinal: 200, dataFimISO: '2026-09-24' }))
      .rejects.toThrow('antes do início');
  });

  it('mesmo dia mas hora de fim antes da hora de início é rejeitado', async () => {
    const repo = fakeRepo({
      list: vi.fn(async () => [makeJornada({ horaInicioISO: '18:00' })]),
    });
    const service = new JornadaService(repo);
    await expect(service.close('j1', { kmFinal: 200, dataFimISO: '2026-09-24', horaFimISO: '08:00' }))
      .rejects.toThrow('antes do início');
  });

  it('fechar uma jornada já fechada é idempotente (não reescreve nem duplica)', async () => {
    const fechada = makeJornada({
      status: 'closed',
      kmFinal: 200,
      dataFimISO: '2026-09-24',
      custoEstimado: 30,
    });
    const repo = fakeRepo({ list: vi.fn(async () => [fechada]) });
    const service = new JornadaService(repo);
    const resultado = await service.close('j1', { kmFinal: 999, dataFimISO: '2026-09-24' });
    expect(resultado).toBe(fechada);
    expect(repo.close).not.toHaveBeenCalled();
  });

  it('jornada inexistente gera erro', async () => {
    const repo = fakeRepo({ list: vi.fn(async () => []) });
    const service = new JornadaService(repo);
    await expect(service.close('nope', { kmFinal: 200, dataFimISO: '2026-09-24' }))
      .rejects.toThrow('não encontrada');
  });
});