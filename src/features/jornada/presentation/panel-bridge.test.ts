import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JornadaAlreadyFinishedError, JornadaAlreadyOpenError } from '../application/jornada-service';

const service = vi.hoisted(() => ({
  start: vi.fn(),
  close: vi.fn(),
  list: vi.fn(),
}));
vi.mock('../index', () => ({ jornadaService: service }));

import { installJornadaBridge, type JornadaVM } from './panel-bridge';

const vm: JornadaVM = {
  status: 'open', kmInicial: 1000, dataInicioISO: '2026-09-30', horaInicioISO: '08:00',
  kmFinal: null, dataFimISO: null, horaFimISO: null, consumoReferencia: null,
  origemConsumo: null, precoReferencia: null, origemPreco: null, custoEstimado: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', {});
  installJornadaBridge();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('ponte da jornada', () => {
  it('propaga conflito de jornada aberta para remover a tentativa local rejeitada', async () => {
    service.start.mockRejectedValue(new JornadaAlreadyOpenError());
    await expect(window.__motoboyJornada!.start(vm)).rejects.toBeInstanceOf(JornadaAlreadyOpenError);
  });

  it('mantém falha de rede sem confirmação para retry', async () => {
    service.start.mockRejectedValue(new Error('unavailable'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(window.__motoboyJornada!.start(vm)).resolves.toBeNull();
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it('não confirma abertura se o retry encontrou a jornada já encerrada', async () => {
    service.start.mockResolvedValue({ id: 'j1', status: 'closed' });
    await expect(window.__motoboyJornada!.start(vm)).rejects.toBeInstanceOf(JornadaAlreadyFinishedError);
  });

  it('refresh devolve dados ao painel sem aplicá-los antes de verificar o UID', async () => {
    service.list.mockResolvedValue([{ id: 'j1', status: 'open' }]);
    window.__applyRemoteJornada = vi.fn();
    await expect(window.__motoboyJornada!.refresh()).resolves.toEqual([{ id: 'j1', status: 'open' }]);
    expect(window.__applyRemoteJornada).not.toHaveBeenCalled();
  });
});
