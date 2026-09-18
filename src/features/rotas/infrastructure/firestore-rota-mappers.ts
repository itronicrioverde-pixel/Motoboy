import type { DocumentData } from 'firebase/firestore';
import type { RotaEntrega, RotaService } from '../domain/rota';

export function toNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toRotaEntrega(raw: DocumentData): RotaEntrega {
  return {
    endereco: String(raw?.endereco ?? ''),
    valor: toNumber(raw?.valor),
    distancia: toNumberOrNull(raw?.distancia),
    tempo: toNumberOrNull(raw?.tempo),
    aproximada: Boolean(raw?.aproximada),
  };
}

export function toRotaService(raw: DocumentData): RotaService {
  return {
    ...(typeof raw?.serviceId === 'string' && raw.serviceId.trim()
      ? { serviceId: raw.serviceId }
      : {}),
    coleta: String(raw?.coleta ?? ''),
    cliente: String(raw?.cliente ?? ''),
    paymentStatus: String(raw?.paymentStatus ?? ''),
    valorTotal: toNumber(raw?.valorTotal),
    entregas: Array.isArray(raw?.entregas) ? raw.entregas.map(toRotaEntrega) : [],
  };
}
