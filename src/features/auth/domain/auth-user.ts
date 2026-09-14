/**
 * Representação de domínio do usuário autenticado.
 *
 * Objeto puro: sem dependência de Firebase, DOM ou localStorage.
 * A camada de infraestrutura converte o User do Firebase para este tipo.
 */

export interface AuthUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly emailVerified: boolean;
}
