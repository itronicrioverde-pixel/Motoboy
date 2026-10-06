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
 * Se já existe gravação em voo, o próximo snapshot espera a conclusão dela.
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
import type { DocumentReference } from 'firebase/firestore';
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
  readonly persist?: (ref: DocumentReference, snapshot: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Cria um writer debounced para um documento Firestore.
 *
 * @param pathBuilder  Função que retorna os segmentos do caminho do documento.
 *                     Recebe o UID capturado no agendamento.
 * @param options      Opções: gate, debounceMs, onError e persistência específica.
 */
export function createFirestoreWriter(
  pathBuilder: (uid: string) => string[],
  options: FirestoreWriterOptions,
): FirestoreWriteHandle {
  const { gate, debounceMs = 500, onError, persist } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledUid: string | null = null;
  let scheduledSnapshot: Record<string, unknown> | null = null;
  let ready = false;
  let inFlight = false;
  let generation = 0;

  function clearPending(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    scheduledUid = null;
    scheduledSnapshot = null;
    ready = false;
  }

  function cancel(): void {
    generation += 1;
    clearPending();
  }

  function flush(): void {
    if (inFlight || !ready || !scheduledUid || !scheduledSnapshot) return;
    const uidNow = currentUid();
    if (!uidNow || uidNow !== scheduledUid || !gate.isOpen) {
      clearPending();
      return;
    }

    const uidAtSchedule = scheduledUid;
    const snap = scheduledSnapshot;
    const writeGeneration = generation;
    clearPending();
    inFlight = true;
    let write: Promise<unknown>;
    try {
      const segments = pathBuilder(uidNow);
      const ref = doc(db, segments.join('/'));
      write = persist ? persist(ref, snap) : setDoc(ref, snap, { merge: true });
    } catch (error) {
      // Uma persistência específica também pode falhar antes de devolver Promise.
      write = Promise.reject(error);
    }
    write
      .then(() => {
        inFlight = false;
        // Um agendamento feito durante esta escrita continua intacto.
        if (ready) flush();
      })
      .catch(function (err) {
        inFlight = false;
        // Só restaura o snapshot falho quando nenhum mais novo o substituiu.
        if (!scheduledSnapshot && generation === writeGeneration) {
          scheduledUid = uidAtSchedule;
          scheduledSnapshot = snap;
          ready = false;
        }
        console.error('[FirestoreWriter] Erro ao salvar:', err);
        if (onError) onError(err);
        if (ready) flush();
      });
  }

  function schedule(snapshot: Record<string, unknown>): void {
    if (!gate.isOpen) return;

    generation += 1;
    clearPending();

    const uid = currentUid();
    if (!uid) return;

    scheduledUid = uid;
    scheduledSnapshot = snapshot;

    timer = setTimeout(function () {
      timer = null;
      ready = true;
      flush();
    }, debounceMs);
  }

  function retry(): void {
    if (inFlight || timer !== null) return;
    if (!scheduledUid || !scheduledSnapshot) return;
    if (!gate.isOpen) return;

    const uidNow = currentUid();
    if (!uidNow || uidNow !== scheduledUid) {
      clearPending();
      return;
    }

    ready = true;
    flush();
  }

  return { cancel, schedule, retry };
}
