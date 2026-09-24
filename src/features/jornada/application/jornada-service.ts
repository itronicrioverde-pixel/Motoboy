/**
 * Casos de uso de Jornada (camada de aplicação).
 *
 * Garante os invariantes:
 *  - no máximo uma jornada em aberto por usuário;
 *  - o km final nunca é menor que o inicial (e o fim nunca fica antes do início);
 *  - fechar uma jornada já fechada é idempotente (não reescreve nem duplica);
 *  - o custo estimado é calculado a partir dos km e das referências, e nunca é
 *    um lançamento financeiro.
 */

import {
  computeDistance,
  computeEstimatedCost,
  type CloseJornada,
  type Jornada,
  type JornadaClosePatch,
  type JornadaRepository,
  type NewJornada,
} from '../domain/jornada';

export class JornadaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JornadaValidationError';
  }
}

function isValidKm(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validateNew(data: NewJornada): void {
  if (!isValidKm(data.kmInicial)) {
    throw new JornadaValidationError('O km inicial deve ser um número maior ou igual a zero.');
  }
  if (!data.dataInicioISO) {
    throw new JornadaValidationError('Informe a data de início.');
  }
  if (!data.horaInicioISO) {
    throw new JornadaValidationError('Informe a hora de início.');
  }
}

function fimNuncaAntesDoInicio(j: Jornada, data: CloseJornada): boolean {
  if (data.dataFimISO < j.dataInicioISO) return false;
  if (data.dataFimISO === j.dataInicioISO) {
    const inicio = `${j.dataInicioISO}T${j.horaInicioISO || '00:00'}`;
    const fim = `${data.dataFimISO}T${data.horaFimISO || '23:59'}`;
    if (fim < inicio) return false;
  }
  return true;
}

export class JornadaService {
  constructor(private readonly repo: JornadaRepository) {}

  list(): Promise<Jornada[]> {
    return this.repo.list();
  }

  async start(data: NewJornada): Promise<Jornada> {
    validateNew(data);
    const open = await this.repo.findOpen();
    if (open) {
      throw new JornadaValidationError('Já existe uma jornada em aberto. Feche-a antes de iniciar outra.');
    }
    return this.repo.add({
      kmInicial: data.kmInicial,
      dataInicioISO: data.dataInicioISO,
      horaInicioISO: data.horaInicioISO,
    });
  }

  async close(id: string, data: CloseJornada): Promise<Jornada> {
    const jornada = await this.findOrThrow(id).catch((error) => {
      throw error;
    });
    return this.closeLoaded(jornada, data);
  }

  private async findOrThrow(id: string): Promise<Jornada> {
    const todas = await this.repo.list();
    const jornada = todas.find((item) => item.id === id);
    if (!jornada) throw new JornadaValidationError('Jornada não encontrada.');
    return jornada;
  }

  /** Fecho idempotente: uma jornada já fechada é retornada como está. */
  private async closeLoaded(jornada: Jornada, data: CloseJornada): Promise<Jornada> {
    if (jornada.status === 'closed') return jornada;
    if (jornada.status !== 'open') {
      throw new JornadaValidationError('Jornada inválida.');
    }
    if (!isValidKm(data.kmFinal)) {
      throw new JornadaValidationError('O km final deve ser um número maior ou igual a zero.');
    }
    if (computeDistance(jornada.kmInicial, data.kmFinal) === null) {
      throw new JornadaValidationError('O km final não pode ser menor que o km inicial.');
    }
    if (!fimNuncaAntesDoInicio(jornada, data)) {
      throw new JornadaValidationError('O fim da jornada não pode ser antes do início.');
    }
    const consumo = data.consumoReferencia && data.consumoReferencia > 0 ? data.consumoReferencia : null;
    const preco = data.precoReferencia && data.precoReferencia > 0 ? data.precoReferencia : null;
    if (consumo === null && data.consumoReferencia !== undefined && data.consumoReferencia !== null) {
      throw new JornadaValidationError('O consumo de referência deve ser maior que zero.');
    }
    if (preco === null && data.precoReferencia !== undefined && data.precoReferencia !== null) {
      throw new JornadaValidationError('O preço de referência deve ser maior que zero.');
    }
    const custoEstimado = computeEstimatedCost(jornada.kmInicial, data.kmFinal, consumo, preco);
    const patch: JornadaClosePatch = {
      kmFinal: data.kmFinal,
      dataFimISO: data.dataFimISO,
      horaFimISO: data.horaFimISO || null,
      consumoReferencia: consumo,
      origemConsumo: data.origemConsumo ?? null,
      precoReferencia: preco,
      origemPreco: data.origemPreco ?? null,
      custoEstimado,
      updatedAt: Date.now(),
    };
    await this.repo.close(jornada.id, patch);
    return { ...jornada, status: 'closed', ...patch };
  }
}