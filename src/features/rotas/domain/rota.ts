/**
 * Domínio de Rotas (histórico de rotas confirmadas).
 *
 * Uma rota confirmada é imutável (só confirma ou cancela) e já nasce com um
 * `id` estável no monólito (`rota-<timestamp>`) — usado como id do documento.
 *
 * Observação de escopo: as entradas de rota (recebido na hora) e as contas de
 * clientes derivadas ainda vivem localmente; serão fechadas na migração de
 * Clientes. Aqui persistimos apenas o histórico de rotas.
 *
 * Falhas de negócio usam Result discriminado — nunca exceções. Funções puras
 * sem DOM, sem Firebase, sem localStorage e sem relógio.
 */

export interface RotaEntrega {
  endereco: string;
  valor: number;
  distancia: number | null;
  tempo: number | null;
  aproximada: boolean;
}

export interface RotaService {
  /** Presente nas rotas novas; rotas históricas anteriores podem não possuir. */
  serviceId?: string;
  /** ID estável do cliente; rotas legadas podem não possuir. */
  clientId?: string;
  coleta: string;
  cliente: string;
  paymentStatus: string;
  valorTotal: number;
  entregas: RotaEntrega[];
}

export interface Rota {
  id: string;
  count: number;
  distancia: number;
  tempoMin: number;
  valorTotal: number;
  custoCombustivel: number | null;
  resultado: number | null;
  recebidoNaHora: number;
  pendente: number;
  data: string;
  dateISO: string;
  hora: string;
  createdAt: string;
  consumoKmL: number;
  precoLitro: number;
  aproximada: boolean;
  services: RotaService[];
  status: 'pending' | 'confirmed';
}

export interface RotaRepository {
  list(): Promise<Rota[]>;
  /** Upsert por id (confirmar rota). */
  save(rota: Rota): Promise<void>;
  observe(callback: (items: Rota[]) => void): () => void;
}

// ---------- Entradas de criação (sem campos derivados) ----------

export interface NewRotaEntrega {
  readonly endereco: string;
  readonly valor: number;
  readonly distancia: number | null;
  readonly tempo: number | null;
  readonly aproximada: boolean;
}

export interface NewRotaService {
  readonly serviceId?: string;
  readonly clientId?: string;
  readonly coleta: string;
  readonly cliente: string;
  readonly paymentStatus: string;
  readonly valorTotal: number;
  readonly entregas: readonly NewRotaEntrega[];
}

/** Entrada para createRota — id, dados brutos e serviços; sem `resultado`. */
export interface NewRota {
  readonly id: string;
  readonly count: number;
  readonly distancia: number;
  readonly tempoMin: number;
  readonly valorTotal: number;
  readonly custoCombustivel: number | null;
  readonly recebidoNaHora: number;
  readonly pendente: number;
  readonly data: string;
  readonly dateISO: string;
  readonly hora: string;
  readonly createdAt: string;
  readonly consumoKmL: number;
  readonly precoLitro: number;
  readonly aproximada: boolean;
  readonly services: readonly NewRotaService[];
}

// ---------- Result discriminado ----------

export type RotaErrorCode =
  | 'EMPTY_ID'
  | 'INVALID_ID'
  | 'ID_TOO_LONG'
  | 'INVALID_COUNT'
  | 'COUNT_MISMATCH'
  | 'NEGATIVE_DISTANCIA'
  | 'NEGATIVE_TEMPO'
  | 'NEGATIVE_VALOR_TOTAL'
  | 'NEGATIVE_CUSTO'
  | 'NEGATIVE_RECEBIDO'
  | 'NEGATIVE_PENDENTE'
  | 'INVALID_CONSUMO'
  | 'INVALID_PRECO_LITRO'
  | 'EMPTY_DATA'
  | 'EMPTY_DATE_ISO'
  | 'EMPTY_HORA'
  | 'EMPTY_CREATED_AT'
  | 'EMPTY_SERVICES'
  | 'EMPTY_COLETA'
  | 'EMPTY_CLIENTE'
  | 'EMPTY_PAYMENT_STATUS'
  | 'NEGATIVE_SERVICE_TOTAL'
  | 'EMPTY_ENTREGA_ENDERECO'
  | 'NEGATIVE_ENTREGA_VALUE'
  | 'VALOR_TOTAL_MISMATCH'
  | 'RECEBIDO_MISMATCH'
  | 'PENDENTE_MISMATCH'
  | 'RECEBIDO_PENDENTE_SUM_MISMATCH'
  | 'RESULTADO_MISMATCH'
  | 'INVALID_STATUS';

export type RotaResult =
  | { readonly ok: true; readonly value: Rota }
  | { readonly ok: false; readonly code: RotaErrorCode; readonly message: string };

export type RotaValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RotaErrorCode; readonly message: string };

// ---------- Constantes ----------

export const MAX_ROTA_ID_LENGTH = 128;
/** Regex do `id` estável de rota gerado pelo monólito: `rota-<timestamp-ms>`. */
export const ROTA_ID_PATTERN = /^rota-\d{1,13}$/;
export const ROTA_PAYMENT_STATUS_RECEIVED = 'received';

// ---------- Helpers pura ----------

function err(code: RotaErrorCode, message: string): { ok: false; code: RotaErrorCode; message: string } {
  return { ok: false, code, message };
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Round2 do domínio — idempotente e sem dependência de DOM.
 * Evita acúmulo de erros de ponto flutuante em valores monetários.
 */
export function roundRouteValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

// ---------- Funções de cálculo puras ----------

/**
 * Soma os valores das entregas de um serviço (round2).
 * Extraído do legacy panel: `service.entregas.reduce((sum, e) => sum + (e.valor || 0), 0)`.
 */
export function computeServicoTotal(entregas: readonly RotaEntrega[]): number {
  const sum = (entregas ?? []).reduce((acc, e) => acc + (isNonNegativeNumber(e?.valor) ? e.valor : 0), 0);
  return roundRouteValue(sum);
}

/**
 * Soma dos valores de TODAS as entregas de uma rota (round2).
 * Extraído do legacy panel: `all.reduce((sum, entrega) => sum + (entrega.valor || 0), 0)`.
 */
export function computeRotasValorTotal(services: readonly NewRotaService[]): number {
  const sum = (services ?? []).reduce(
    (acc, s) => acc + computeServicoTotal(s.entregas ?? []),
    0,
  );
  return roundRouteValue(sum);
}

/**
 * Conta o total de entregas em todos os serviços.
 */
export function countAllEntregas(services: readonly NewRotaService[]): number {
  return (services ?? []).reduce(
    (acc, s) => acc + (Array.isArray(s.entregas) ? s.entregas.length : 0),
    0,
  );
}

/**
 * Custo de combustível: `(totalKm / consumoKmL) * precoLitro` (round2).
 * Retorna `null` quando não há configuração válida de consumo ou preço.
 *
 * Extraído do legacy panel:
 *   `CONSUMO_ATUAL > 0 && PRECO_ATUAL > 0
 *      ? round2((totalKm / CONSUMO_ATUAL) * PRECO_ATUAL) : null`
 */
export function computeFuelCost(
  totalKm: number,
  consumoKmL: number,
  precoLitro: number,
): number | null {
  if (!isPositiveNumber(totalKm) || !isPositiveNumber(consumoKmL) || !isPositiveNumber(precoLitro)) {
    return null;
  }
  const km = isNonNegativeNumber(totalKm) ? totalKm : 0;
  return roundRouteValue((km / consumoKmL) * precoLitro);
}

/**
 * Resultado da rota: `valorTotal - custoCombustivel` (round2).
 * Retorna `null` quando `custoCombustivel` é `null`.
 *
 * Extraído do legacy panel:
 *   `custoCombustivel === null ? null : round2(valorTotal - custoCombustivel)`
 */
export function computeRouteResultado(valorTotal: number, custoCombustivel: number | null): number | null {
  if (custoCombustivel === null) return null;
  return roundRouteValue(valorTotal - custoCombustivel);
}

/**
 * Split de valores por status de pagamento.
 * `recebido` = soma de serviços cujo paymentStatus === 'received'.
 * `pendente`  = soma de serviços cujo paymentStatus !== 'received'.
 *
 * Extraído do legacy panel:
 *   `if (s.paymentStatus === 'received') recebidoNaHora += totalServico;
 *    else pendenteTotal += totalServico;`
 */
export function computeReceivedPending(
  services: readonly NewRotaService[],
): { recebido: number; pendente: number } {
  let recebido = 0;
  let pendente = 0;
  for (const s of services ?? []) {
    const total = computeServicoTotal(s.entregas ?? []);
    if (s.paymentStatus === ROTA_PAYMENT_STATUS_RECEIVED) {
      recebido += total;
    } else {
      pendente += total;
    }
  }
  return { recebido: roundRouteValue(recebido), pendente: roundRouteValue(pendente) };
}

// ---------- Factory ----------

function validaRotaId(id: unknown): RotaErrorCode | null {
  if (typeof id !== 'string' || id.length === 0) return 'EMPTY_ID';
  if (id.length > MAX_ROTA_ID_LENGTH) return 'ID_TOO_LONG';
  if (id.includes('/')) return 'INVALID_ID';
  if (id === '.' || id === '..') return 'INVALID_ID';
  if (id.startsWith('__') && id.endsWith('__')) return 'INVALID_ID';
  return null;
}

/**
 * Cria e valida uma Rota a partir de um input neutro.
 *
 * Verifica:
 * - `id` estável e válido (formato `rota-<timestamp>`, sem `/` etc.);
 * - `count` coincide com o total de entregas em `services`;
 * - `valorTotal` coincide com a soma das entregas;
 * - `recebidoNaHora`/`pendente` coincidem com o split por paymentStatus;
 * - `resultado` é consistente com `valorTotal - custoCombustivel`;
 * - todos os valores monetários são não-negativos;
 * - `consumoKmL`/`precoLitro` são positivos;
 * - campos de data/hora não estão vazios.
 *
 * Nunca lança exceção de regra de negócio. Calcula `resultado` internamente.
 */
export function createRota(input: NewRota): RotaResult {
  // --- id ---
  const idCode = validaRotaId(input.id);
  if (idCode) return err(idCode, 'id inválido.');

  // --- services estruturais ---
  const services = input.services;
  if (!Array.isArray(services) || services.length === 0) {
    return err('EMPTY_SERVICES', 'Rota precisa de pelo menos um serviço.');
  }

  // --- valores monetários não-negativos / positivos ---
  if (!isNonNegativeNumber(input.distancia)) {
    return err('NEGATIVE_DISTANCIA', 'distancia deve ser não-negativa.');
  }
  if (!isNonNegativeNumber(input.tempoMin)) {
    return err('NEGATIVE_TEMPO', 'tempoMin deve ser não-negativo.');
  }
  if (!isNonNegativeNumber(input.valorTotal)) {
    return err('NEGATIVE_VALOR_TOTAL', 'valorTotal deve ser não-negativo.');
  }
  if (input.custoCombustivel !== null && !isNonNegativeNumber(input.custoCombustivel)) {
    return err('NEGATIVE_CUSTO', 'custoCombustivel deve ser não-negativo ou null.');
  }
  if (!isNonNegativeNumber(input.recebidoNaHora)) {
    return err('NEGATIVE_RECEBIDO', 'recebidoNaHora deve ser não-negativo.');
  }
  if (!isNonNegativeNumber(input.pendente)) {
    return err('NEGATIVE_PENDENTE', 'pendente deve ser não-negativo.');
  }
  if (!isPositiveNumber(input.consumoKmL)) {
    return err('INVALID_CONSUMO', 'consumoKmL deve ser positivo (> 0).');
  }
  if (!isPositiveNumber(input.precoLitro)) {
    return err('INVALID_PRECO_LITRO', 'precoLitro deve ser positivo (> 0).');
  }

  // --- datas ---
  if (typeof input.data !== 'string' || input.data.trim().length === 0) {
    return err('EMPTY_DATA', 'data não informada.');
  }
  if (typeof input.dateISO !== 'string' || input.dateISO.trim().length === 0) {
    return err('EMPTY_DATE_ISO', 'dateISO não informada.');
  }
  if (typeof input.hora !== 'string' || input.hora.trim().length === 0) {
    return err('EMPTY_HORA', 'hora não informada.');
  }
  if (typeof input.createdAt !== 'string' || input.createdAt.trim().length === 0) {
    return err('EMPTY_CREATED_AT', 'createdAt não informada.');
  }

  // --- validação de cada serviço / entrega ---
  for (const s of services) {
    if (typeof s.coleta !== 'string' || s.coleta.trim().length === 0) {
      return err('EMPTY_COLETA', 'Serviço sem coleta.');
    }
    if (typeof s.cliente !== 'string' || s.cliente.trim().length === 0) {
      return err('EMPTY_CLIENTE', 'Serviço sem cliente.');
    }
    if (typeof s.paymentStatus !== 'string' || s.paymentStatus.trim().length === 0) {
      return err('EMPTY_PAYMENT_STATUS', 'Serviço sem paymentStatus.');
    }
    if (!isNonNegativeNumber(s.valorTotal)) {
      return err('NEGATIVE_SERVICE_TOTAL', 'valorTotal do serviço deve ser não-negativo.');
    }
    const entregas = s.entregas;
    if (!Array.isArray(entregas) || entregas.length === 0) {
      return err('EMPTY_SERVICES', 'Cada serviço precisa de pelo menos uma entrega.');
    }
    for (const e of entregas) {
      if (typeof e.endereco !== 'string' || e.endereco.trim().length === 0) {
        return err('EMPTY_ENTREGA_ENDERECO', 'Entrega sem endereço.');
      }
      if (!isNonNegativeNumber(e.valor)) {
        return err('NEGATIVE_ENTREGA_VALUE', 'Valor da entrega deve ser não-negativo.');
      }
    }
    const sTotal = computeServicoTotal(s.entregas);
    if (roundRouteValue(s.valorTotal) !== sTotal) {
      return err(
        'VALOR_TOTAL_MISMATCH',
        `valorTotal do serviço (${s.valorTotal}) não bate com a soma das entregas (${sTotal}).`,
      );
    }
  }

  // --- contagem ---
  if (!Number.isInteger(input.count) || input.count < 1) {
    return err('INVALID_COUNT', 'count deve ser um inteiro positivo.');
  }
  const entregaCount = countAllEntregas(services);
  if (input.count !== entregaCount) {
    return err(
      'COUNT_MISMATCH',
      `count (${input.count}) não coincide com o total de entregas (${entregaCount}).`,
    );
  }

  // --- consistência dos totais ---
  const expectedValorTotal = computeRotasValorTotal(services);
  if (roundRouteValue(input.valorTotal) !== expectedValorTotal) {
    return err(
      'VALOR_TOTAL_MISMATCH',
      `valorTotal (${input.valorTotal}) não coincide com a soma de todas as entregas (${expectedValorTotal}).`,
    );
  }
  const split = computeReceivedPending(services);
  if (roundRouteValue(input.recebidoNaHora) !== split.recebido) {
    return err(
      'RECEBIDO_MISMATCH',
      `recebidoNaHora (${input.recebidoNaHora}) não coincide com a soma dos serviços recebidos (${split.recebido}).`,
    );
  }
  if (roundRouteValue(input.pendente) !== split.pendente) {
    return err(
      'PENDENTE_MISMATCH',
      `pendente (${input.pendente}) não coincide com a soma dos serviços a receber (${split.pendente}).`,
    );
  }
  if (roundRouteValue(input.recebidoNaHora + input.pendente) !== expectedValorTotal) {
    return err(
      'RECEBIDO_PENDENTE_SUM_MISMATCH',
      'recebidoNaHora + pendente não coincide com valorTotal.',
    );
  }

  // --- consistência de resultado (computado internamente, nunca validado do input) ---
  const expectedResultado = computeRouteResultado(expectedValorTotal, input.custoCombustivel);

  const rota: Rota = {
    id: input.id,
    count: input.count,
    distancia: input.distancia,
    tempoMin: input.tempoMin,
    valorTotal: roundRouteValue(input.valorTotal),
    custoCombustivel:
      input.custoCombustivel !== null ? roundRouteValue(input.custoCombustivel) : null,
    resultado: expectedResultado,
    recebidoNaHora: roundRouteValue(input.recebidoNaHora),
    pendente: roundRouteValue(input.pendente),
    data: input.data,
    dateISO: input.dateISO,
    hora: input.hora,
    createdAt: input.createdAt,
    consumoKmL: input.consumoKmL,
    precoLitro: input.precoLitro,
    aproximada: Boolean(input.aproximada),
    services: services.map((s) => ({
      ...(s.serviceId ? { serviceId: s.serviceId } : {}),
      ...(s.clientId ? { clientId: s.clientId } : {}),
      coleta: s.coleta,
      cliente: s.cliente,
      paymentStatus: s.paymentStatus,
      valorTotal: roundRouteValue(s.valorTotal),
      entregas: (s.entregas ?? []).map((e: NewRotaEntrega) => ({
        endereco: e.endereco,
        valor: roundRouteValue(e.valor),
        distancia: e.distancia ?? null,
        tempo: e.tempo ?? null,
        aproximada: Boolean(e.aproximada),
      })),
    })),
    status: 'confirmed',
  };
  return { ok: true, value: rota };
}

/**
 * Valida uma Rota já montada (inclusive a coerência de `resultado` e dos
 * totais) — usada pela fronteira de persistência para rejeitar entidades
 * externas malformadas antes de gravar. Não corrige nem normaliza.
 */
export function validateRota(rota: Rota): RotaValidation {
  const idCode = validaRotaId(rota.id);
  if (idCode) return err(idCode, 'id inválido.');

  if (!Number.isInteger(rota.count) || rota.count < 1) {
    return err('INVALID_COUNT', 'count deve ser um inteiro positivo.');
  }

  if (!isNonNegativeNumber(rota.distancia)) {
    return err('NEGATIVE_DISTANCIA', 'distancia deve ser não-negativa.');
  }
  if (!isNonNegativeNumber(rota.tempoMin)) {
    return err('NEGATIVE_TEMPO', 'tempoMin deve ser não-negativo.');
  }
  if (!isNonNegativeNumber(rota.valorTotal)) {
    return err('NEGATIVE_VALOR_TOTAL', 'valorTotal deve ser não-negativo.');
  }
  if (rota.custoCombustivel !== null && !isNonNegativeNumber(rota.custoCombustivel)) {
    return err('NEGATIVE_CUSTO', 'custoCombustivel deve ser não-negativo ou null.');
  }
  if (!isNonNegativeNumber(rota.recebidoNaHora)) {
    return err('NEGATIVE_RECEBIDO', 'recebidoNaHora deve ser não-negativo.');
  }
  if (!isNonNegativeNumber(rota.pendente)) {
    return err('NEGATIVE_PENDENTE', 'pendente deve ser não-negativo.');
  }
  if (!isPositiveNumber(rota.consumoKmL)) {
    return err('INVALID_CONSUMO', 'consumoKmL deve ser positivo (> 0).');
  }
  if (!isPositiveNumber(rota.precoLitro)) {
    return err('INVALID_PRECO_LITRO', 'precoLitro deve ser positivo (> 0).');
  }
  if (typeof rota.data !== 'string' || rota.data.trim().length === 0) {
    return err('EMPTY_DATA', 'data não informada.');
  }
  if (typeof rota.dateISO !== 'string' || rota.dateISO.trim().length === 0) {
    return err('EMPTY_DATE_ISO', 'dateISO não informada.');
  }
  if (typeof rota.hora !== 'string' || rota.hora.trim().length === 0) {
    return err('EMPTY_HORA', 'hora não informada.');
  }
  if (typeof rota.createdAt !== 'string' || rota.createdAt.trim().length === 0) {
    return err('EMPTY_CREATED_AT', 'createdAt não informada.');
  }

  if (!Array.isArray(rota.services) || rota.services.length === 0) {
    return err('EMPTY_SERVICES', 'Rota precisa de pelo menos um serviço.');
  }
  if (rota.status !== 'pending' && rota.status !== 'confirmed') {
    return err('INVALID_STATUS', 'status deve ser "pending" ou "confirmed".');
  }
  if (rota.count !== countAllEntregas(rota.services)) {
    return err('COUNT_MISMATCH', `count não coincide com o total de entregas.`);
  }
  if (roundRouteValue(rota.valorTotal) !== computeRotasValorTotal(rota.services)) {
    return err('VALOR_TOTAL_MISMATCH', 'valorTotal não coincide com a soma das entregas.');
  }
  const split = computeReceivedPending(rota.services);
  if (roundRouteValue(rota.recebidoNaHora) !== split.recebido) {
    return err('RECEBIDO_MISMATCH', 'recebidoNaHora não bate com os serviços recebidos.');
  }
  if (roundRouteValue(rota.pendente) !== split.pendente) {
    return err('PENDENTE_MISMATCH', 'pendente não bate com os serviços a receber.');
  }
  const expectedResultado = computeRouteResultado(rota.valorTotal, rota.custoCombustivel);
  if (rota.resultado !== expectedResultado) {
    return err('RESULTADO_MISMATCH', 'resultado não coincide com valorTotal - custoCombustivel.');
  }

  return { ok: true };
}
