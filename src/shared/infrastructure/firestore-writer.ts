/**
 * Módulo de escrita debounced no Firestore.
 *
 * Extraído do panel.js para permitir teste importável e consolidação de escritas.
 * Captura UID e snapshot imutável no agendamento. Antes de escrever, confirma
 * que o UID atual ainda é o mesmo. Cancela escrita se o UID mudou (logout,
 * troca de usuário) ou se o gate está fechado.
 *
 * Chamadas consecutivas do mesmo usuário resultam em apenas uma gravação
 * com o snapshot mais recente (debounce padrão com clear/reset).
 *
 * Em falha, preserva o snapshot e UID para retry. O chamador pode chamar
 * retry() para reenviar. Duas chamadas de retry() não criam duas gravações.
 * Um novo schedule() substitui o snapshot que falhou.
 *
 * retry() não executa se:
 * - O UID mudou desde o agendamento original (logout/troca de usuário).
 * - O gate está fechado.
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase.js';
import { currentUid } from '../../features/auth/application/auth-service';
import type { SyncGate } from '../application/sync-gate';

export interface FirestoreWriteHandle {
  cancel(): void;
  schedule(snapshot: Record<string, unknown>): void;
  retry(): void;
}

export interface FirestoreWriterOptions {
  readonly gate: SyncGate;
  readonly debounceMs?: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Cria um writer debounced para um documento Firestore.
 *
 * @param pathBuilder  Função que retorna os segmentos do caminho do documento.
 *                     Recebe o UID capturado no agendamento.
 * @param options      Opções: gate, debounceMs, onError callback.
 */
export function createFirestoreWriter(
  pathBuilder: (uid: string) => string[],
  options: FirestoreWriterOptions,
): FirestoreWriteHandle {
  const { gate, debounceMs = 500, onError } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledUid: string | null = null;
  let scheduledSnapshot: Record<string, unknown> | null = null;
  let retryPending = false;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    scheduledUid = null;
    scheduledSnapshot = null;
    retryPending = false;
  }

  function executeWrite(uidAtSchedule: string, snap: Record<string, unknown>): void {
    const uidNow = currentUid();
    if (!uidNow || uidNow !== uidAtSchedule) return;
    if (!gate.isOpen) return;

    const segments = pathBuilder(uidNow);
    const ref = doc(db, segments.join('/'));
    setDoc(ref, snap ?? {}, { merge: true })
      .then(() => {
        scheduledUid = null;
        scheduledSnapshot = null;
        retryPending = false;
      })
      .catch(function (err) {
        console.error('[FirestoreWriter] Erro ao salvar:', err);
        retryPending = false;
        if (onError) onError(err);
      });
  }

  function schedule(snapshot: Record<string, unknown>): void {
    if (!gate.isOpen) return;

    cancel();

    const uid = currentUid();
    if (!uid) return;

    scheduledUid = uid;
    scheduledSnapshot = snapshot;

    timer = setTimeout(function () {
      timer = null;
      const uidAtSchedule = scheduledUid;
      const snap = scheduledSnapshot;

      if (!uidAtSchedule || !snap) return;

      executeWrite(uidAtSchedule, snap);
    }, debounceMs);
  }

  function retry(): void {
    if (retryPending) return;
    if (!scheduledUid || !scheduledSnapshot) return;
    if (!gate.isOpen) return;

    const uidNow = currentUid();
    if (!uidNow || uidNow !== scheduledUid) {
      scheduledUid = null;
      scheduledSnapshot = null;
      return;
    }

    retryPending = true;
    executeWrite(scheduledUid, scheduledSnapshot);
  }

  return { cancel, schedule, retry };
}
