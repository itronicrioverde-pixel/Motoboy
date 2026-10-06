/**
 * SyncGate — porta lógica para controlar sincronização.
 *
 * Usado pelo painel para bloquear ações até a hidratação remota:
 * - clientsHydrated: impede mutações financeiras antes de carregar os clientes
 * - motoHydrated: bloqueia saveMotoToFirestore/syncMotoToFirestore
 * A projeção financeira clients/data não utiliza writer debounced.
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
