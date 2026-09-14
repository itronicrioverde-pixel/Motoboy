/**
 * Porta de autenticação (domínio).
 *
 * Interface neutra: a camada application depende dela, não do Firebase.
 * Qualquer provedor (Firebase, Supabase, mock) pode implementar esta interface.
 */

import type { AuthUser } from './auth-user';

export type Unsubscribe = () => void;

/**
 * Operações de autenticação abstratas.
 * Todas as implementações concretas ficam na camada infrastructure.
 */
export interface AuthRepository {
  /** Persistência da sessão (deve ser chamada antes de operações que dependem dela). */
  ensurePersistence(): Promise<void>;

  /** Login com e-mail e senha. Lança erro do tipo AuthErrorCode em caso de falha. */
  signIn(email: string, password: string): Promise<AuthUser>;

  /** Cria conta, define nome e envia verificação. Retorna o usuário criado. */
  signUp(name: string, email: string, password: string): Promise<AuthUser>;

  /** Envia e-mail de recuperação. Erros de "usuário não encontrado" são silenciados. */
  sendResetEmail(email: string): Promise<void>;

  /** Reenvia e-mail de verificação para o usuário atual. */
  resendVerification(): Promise<void>;

  /** Recarrega o usuário e retorna se o e-mail foi verificado. */
  reloadAndCheckVerified(): Promise<boolean>;

  /** Encerra a sessão. */
  signOut(): Promise<void>;

  /** Retorna o usuário atual (ou null). */
  getCurrentUser(): AuthUser | null;

  /** uid do usuário atual (atalho para quando só precisa do uid). */
  currentUid(): string | null;

  /** Observa mudanças no estado de autenticação. */
  onAuthStateChanged(callback: (user: AuthUser | null) => void): Unsubscribe;
}
