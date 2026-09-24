/**
 * Domínio de Jornada.
 *
 * Uma jornada é o período entre a abertura (oddômetro inicial) e o fechamento
 * (oddômetro final) do trabalho do motoboy. Ela produz apenas um CUSTO
 * ESTIMADO com base na quilometragem percorrida, no consumo de referência
 * (km/L) e no preço de referência do combustível — nunca vira uma despesa.
 *
 * Camada mais interna: só regras e formato dos dados. NÃO conhece Firestore,
 * DOM, localStorage nem formatação de exibição.
 */

export type JornadaStatus = 'open' | 'closed';

/** Origem do consumo de referência registrado ao fechar a jornada. */
export type ConsumoOrigem = 'moto' | 'historico' | 'manual';

/** Origem do preço de referência registrado ao fechar a jornada. */
export type PrecoOrigem = 'abastecimento' | 'manual';

export interface Jornada {
  id: string;
  status: JornadaStatus;
  /** Oddômetro (km) no início. */
  kmInicial: number;
  /** Data no formato ISO local (yyyy-mm-dd). */
  dataInicioISO: string;
  /** Hora no formato local (HH:mm). */
  horaInicioISO: string;
  /** Oddômetro (km) no fechamento. */
  kmFinal: number | null;
  dataFimISO: string | null;
  horaFimISO: string | null;
  /** Consumo (km/L) vigente ao fechar, quando disponível. */
  consumoReferencia: number | null;
  origemConsumo: ConsumoOrigem | null;
  /** Preço (R$/L) vigente ao fechar, quando disponível. */
  precoReferencia: number | null;
  origemPreco: PrecoOrigem | null;
  /** Custo estimado (R$) — derivado, NUNCA registrado como despesa. */
  custoEstimado: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Dados de entrada para abrir uma jornada (sem campos gerados). */
export interface NewJornada {
  kmInicial: number;
  dataInicioISO: string;
  horaInicioISO: string;
}

/** Dados de entrada para fechar uma jornada. */
export interface CloseJornada {
  kmFinal: number;
  dataFimISO: string;
  horaFimISO?: string;
  consumoReferencia?: number | null;
  origemConsumo?: ConsumoOrigem | null;
  precoReferencia?: number | null;
  origemPreco?: PrecoOrigem | null;
}

/** Patch persistido pelo repositório ao fechar. */
export interface JornadaClosePatch {
  kmFinal: number;
  dataFimISO: string;
  horaFimISO: string | null;
  consumoReferencia: number | null;
  origemConsumo: ConsumoOrigem | null;
  precoReferencia: number | null;
  origemPreco: PrecoOrigem | null;
  custoEstimado: number | null;
  updatedAt: number;
}

/**
 * Distância percorrida (km) entre dois oddômetros. Null quando o dado não
 * permite calcular (km final menor que o inicial ou valores inválidos).
 */
export function computeDistance(kmInicial: number, kmFinal: number): number | null {
  if (!Number.isFinite(kmInicial) || !Number.isFinite(kmFinal)) return null;
  if (kmFinal < kmInicial) return null;
  return kmFinal - kmInicial;
}

/**
 * Custo estimado (R$) de uma jornada: distância ÷ consumo (km/L) × preço (R$/L).
 * Null quando falta consumo, preço ou distância válidos. NUNCA é despesa.
 */
export function computeEstimatedCost(
  kmInicial: number,
  kmFinal: number,
  consumoReferencia: number | null,
  precoReferencia: number | null,
): number | null {
  const distance = computeDistance(kmInicial, kmFinal);
  if (distance === null) return null;
  if (!(consumoReferencia && consumoReferencia > 0)) return null;
  if (!(precoReferencia && precoReferencia > 0)) return null;
  const cost = (distance / consumoReferencia) * precoReferencia;
  return Math.round(cost * 100) / 100;
}

/**
 * Porta de saída (Dependency Inversion): o caso de uso depende desta
 * interface, não de uma implementação concreta.
 */
export interface JornadaRepository {
  list(): Promise<Jornada[]>;
  /** A jornada em aberto do dono, se existir. */
  findOpen(): Promise<Jornada | null>;
  add(data: NewJornada): Promise<Jornada>;
  close(id: string, patch: JornadaClosePatch): Promise<void>;
}