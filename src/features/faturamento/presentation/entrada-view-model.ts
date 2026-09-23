/**
 * View model de Entrada para o painel legado.
 *
 * Função pura: não toca DOM, window, localStorage nem Firebase. Recebe uma
 * Entrada do domínio e devolve a forma usada pelo array `entradas` do painel,
 * PRESERVANDO a identidade de recebimento (receiptOperationId/source/clientId/
 * clientName). Sem esses campos, uma entrada reidratada do Firestore não seria
 * encontrada pelo upsert de applyReceiptResult e um retry poderia duplicá-la.
 */

import type { Entrada } from '../domain/entrada';

export interface EntradaEntryVM {
  fsId: string | null;
  desc: string;
  valor: number;
  /** Rótulo curto de data: "Hoje", "Ontem" ou "12/06/2026". */
  data: string;
  dateISO: string;
  routeId?: string;
  clientName?: string;
  receiptOperationId?: string;
  source?: string | null;
  clientId?: string | null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localTodayISO(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Rótulo curto e humano de um dateISO. `nowISO` é injetável para determinismo
 * em testes; sem ele usa a data local de hoje.
 */
export function dateLabelForISO(iso: string, nowISO?: string): string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Hoje';
  const hoje = nowISO ?? localTodayISO(new Date());
  const ontem = addDaysISO(hoje, -1);
  if (iso === hoje) return 'Hoje';
  if (iso === ontem) return 'Ontem';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function entradaToEntryVM(entity: Entrada): EntradaEntryVM {
  const valor = Number(entity.valor);
  return {
    fsId: entity.id,
    desc: entity.desc || '',
    valor: Number.isFinite(valor) ? valor : 0,
    data: dateLabelForISO(entity.dateISO),
    dateISO: entity.dateISO,
    clientName: entity.clientName ?? undefined,
    receiptOperationId: entity.receiptOperationId,
    source: entity.source ?? undefined,
    clientId: entity.clientId ?? undefined,
  };
}