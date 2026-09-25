/**
 * Política de ação ao tocar em "Iniciar jornada" no painel.
 *
 * Se já existir uma jornada em aberto ainda SEM id remoto (fsId ausente —
 * "pendente" ou "falhou"), a ação correta é REENVIAR a mesma jornada, e não
 * abrir um formulário que criaria um segundo registro. Com fsId confirmado (ou
 * sem jornada em aberto), abre o formulário de uma jornada nova.
 *
 * Módulo puro (sem Firebase, DOM ou localStorage): a decisão vem de um
 * registro mantido em memória pelo painel.
 */

export interface JornadaStartCandidate {
  status: string;
  fsId?: string | null;
}

export type JornadaStartPlan =
  | { action: 'form'; record: null }
  | { action: 'retry'; record: JornadaStartCandidate };

/** Decide entre abrir o formulário ou reenviar a abertura ainda não confirmada. */
export function jornadaStartPlan(open: JornadaStartCandidate | null): JornadaStartPlan {
  if (open && open.status === 'open' && !(typeof open.fsId === 'string' && open.fsId)) {
    return { action: 'retry', record: open };
  }
  return { action: 'form', record: null };
}

/** Estreita o tipo quando o plano é um retry da jornada existente. */
export function isStartRetry(
  plan: JornadaStartPlan,
): plan is Extract<JornadaStartPlan, { action: 'retry' }> {
  return plan.action === 'retry';
}