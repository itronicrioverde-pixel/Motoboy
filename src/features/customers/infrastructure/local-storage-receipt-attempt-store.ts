/**
 * Persistência da tentativa de recebimento no localStorage.
 *
 * - Chave versionada e isolada por UID: cada usuário só lê/limpa a própria tentativa.
 * - Leituras tolerantes: JSON corrompido ou formato inválido retornam null.
 * - Escritas rejeitam payload inválido (a falha propaga e impede o gateway).
 */

import type { PendingReceiptAttempt, PendingReceiptStore } from '../application/receipt-submission-manager';

export const RECEIPT_ATTEMPT_STORAGE_PREFIX = 'motoboy.receipt-attempt.v1';

export function receiptAttemptKey(uid: string): string {
  return `${RECEIPT_ATTEMPT_STORAGE_PREFIX}.${uid}`;
}

/** Abstração mínima de storage (localStorage ou um fake nos testes). */
export interface ReceiptAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validação defensiva da tentativa lida/gravada.
 * Retorna cópia saneada ou null quando o formato é inválido.
 */
function normalizeAttempt(value: unknown): PendingReceiptAttempt | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  const uid = typeof v.uid === 'string' ? v.uid : '';
  const receiptOperationId = typeof v.receiptOperationId === 'string' ? v.receiptOperationId : '';
  const valor = Number(v.valor);
  const dateISO = typeof v.dateISO === 'string' ? v.dateISO : '';
  const dateLabel = typeof v.dateLabel === 'string' && v.dateLabel.trim() ? v.dateLabel : '';
  const createdAt = Number(v.createdAt);

  if (!uid) return null;
  if (!receiptOperationId) return null;
  if (!Number.isFinite(valor) || valor <= 0) return null;
  if (!DATE_ISO_REGEX.test(dateISO)) return null;
  if (!dateLabel) return null;
  if (!Number.isFinite(createdAt)) return null;

  const clientId =
    typeof v.clientId === 'string' && v.clientId.trim() ? v.clientId.trim() : undefined;
  const legacyLookupName =
    typeof v.legacyLookupName === 'string' && v.legacyLookupName.trim()
      ? v.legacyLookupName.trim()
      : undefined;
  const clientName =
    typeof v.clientName === 'string' && v.clientName.trim() ? v.clientName.trim() : undefined;
  if (!clientId && !legacyLookupName) return null;

  return {
    uid,
    receiptOperationId,
    valor,
    dateISO,
    dateLabel,
    createdAt,
    clientId,
    legacyLookupName,
    clientName,
  };
}

export function createLocalStorageReceiptAttemptStore(
  storage?: ReceiptAttemptStorage,
): PendingReceiptStore {
  const backend: ReceiptAttemptStorage | undefined = storage ??
    (globalThis as { localStorage?: ReceiptAttemptStorage }).localStorage;

  function load(uid: string): PendingReceiptAttempt | null {
    if (!uid || !backend) return null;
    try {
      const raw = backend.getItem(receiptAttemptKey(uid));
      if (raw == null) return null;
      return normalizeAttempt(JSON.parse(raw));
    } catch {
      // JSON corrompido (ou storage indisponível) não pode quebrar o painel.
      return null;
    }
  }

  function save(attempt: PendingReceiptAttempt): void {
    const normalized = normalizeAttempt(attempt);
    if (!normalized) {
      throw new Error('Tentativa de recebimento inválida para persistir.');
    }
    if (!backend) {
      throw new Error('Storage de tentativas indisponível.');
    }
    backend.setItem(receiptAttemptKey(normalized.uid), JSON.stringify(normalized));
  }

  function clear(uid: string, receiptOperationId: string): void {
    if (!uid || !receiptOperationId || !backend) return;
    // Só remove quando a tentativa realmente pertence a esse uid + operação.
    const current = load(uid);
    if (current && current.uid === uid && current.receiptOperationId === receiptOperationId) {
      backend.removeItem(receiptAttemptKey(uid));
    }
  }

  return { load, save, clear };
}