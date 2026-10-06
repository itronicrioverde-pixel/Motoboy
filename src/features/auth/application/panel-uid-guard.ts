/**
 * O painel legado mantém dados em memória. Uma mudança de UID exige um novo
 * carregamento mesmo quando localStorage está indisponível.
 */
export function panelUidChanged(activeUid: string | null, nextUid: string): boolean {
  return activeUid !== null && activeUid !== nextUid;
}
