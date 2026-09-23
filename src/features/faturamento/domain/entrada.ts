/**
 * Domínio de Faturamento — Entradas (recebimentos manuais).
 *
 * Só as entradas MANUAIS pertencem a esta feature. Entradas geradas por Rotas
 * (com routeId/clientName) são responsabilidade de Rotas e não passam por aqui.
 */

export interface Entrada {
  id: string;
  desc: string;
  valor: number;
  /** Data ISO local (yyyy-mm-dd). */
  dateISO: string;
  edited: boolean;
  editReason: string | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Identidade de recebimento (quando a entrada veio de um recebimento de cliente).
   * No Firestore o documento é gravado em entradas/{receiptOperationId}; o mapper
   * preserva esse campo para que o upsert local (applyReceiptResult) nunca duplique.
   */
  receiptOperationId?: string;
  /** Origem da entrada. Recebimentos usam 'client_receipt'; manuais não têm. */
  source?: string | null;
  clientId?: string | null;
  clientName?: string | null;
}

export interface NewEntrada {
  desc: string;
  valor: number;
  dateISO: string;
}

export interface EditEntrada {
  desc?: string;
  valor?: number;
  dateISO?: string;
  editReason?: string | null;
}

export interface EntradaRepository {
  list(): Promise<Entrada[]>;
  add(data: NewEntrada): Promise<Entrada>;
  update(id: string, data: EditEntrada): Promise<void>;
  remove(id: string): Promise<void>;
  observe(callback: (items: Entrada[]) => void): () => void;
}
