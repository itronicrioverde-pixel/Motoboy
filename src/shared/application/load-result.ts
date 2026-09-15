/**
 * Resultado discriminated de operações de carga remota.
 *
 * Modelo único: toda função de carga retorna LoadResult.
 * - Sucesso (vazio ou com dados): { ok: true, data }
 * - Falha (rede, permissão, parsing): { ok: false, error }
 *
 * Nunca lança erro para o chamador — falha é um resultado, não uma exceção.
 * Resultado vazio é sucesso: { ok: true, data: [] }.
 */

export type LoadResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: unknown };

/** Type guard: verifica se o resultado é sucesso. */
export function isLoadSuccess<T>(result: LoadResult<T>): result is { ok: true; data: T } {
  return result.ok === true;
}

/**
 * Cria um resultado de sucesso com dados.
 * Aceita vazio ([]) como sucesso válido.
 */
export function loadOk<T>(data: T): LoadResult<T> {
  return { ok: true, data };
}

/**
 * Cria um resultado de falha.
 * Captura o erro original sem lançar exceção.
 */
export function loadFail(error: unknown): LoadResult<never> {
  return { ok: false, error };
}
