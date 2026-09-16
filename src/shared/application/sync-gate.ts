/**
 * SyncGate — porta lógica para controlar sincronização.
 *
 * Usado pelo panel.js para bloquear/liberar escritas ao Firestore:
 * - clientsRemoteRead: bloqueia saveClientsToFirestore antes da leitura remota
 * - clientsHydrated: bloqueia syncClientsToFirestore antes da hidratação
 * - motoHydrated: bloqueia saveMotoToFirestore/syncMotoToFirestore
 *
 * A porta começa fechada. Somente a hidratação bem-sucedida a abre.
 * Enquanto fechada, qualquer tentativa de escrita é ignorada silenciosamente.
 */
export class SyncGate {
  private _open: boolean;

  constructor(initialState: boolean = false) {
    this._open = initialState;
  }

  /** true quando a porta está aberta (sincronização liberada). */
  get isOpen(): boolean {
    return this._open;
  }

  /** Abre a porta — libera sincronização. */
  open(): void {
    this._open = true;
  }

  /** Fecha a porta — bloqueia sincronização. */
  close(): void {
    this._open = false;
  }

  /** Retorna true se a porta está aberta. Alias de isOpen para uso em guardas. */
  check(): boolean {
    return this._open;
  }
}
