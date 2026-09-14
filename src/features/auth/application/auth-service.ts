/**
 * Serviço de autenticação (camada de aplicação).
 *
 * Concentra a lógica de autenticação. A camada de apresentação (login-view)
 * chama estas funções e nunca lida com implementações concretas.
 *
 * RF-04 (mensagens de erro), RF-05 (sessão persistente), RF-06 (recuperação),
 * RF-09 (sair), RF-10 (estado de autenticação para proteger o painel).
 *
 * A implementação concreta (Firebase) é injetada via AuthRepository.
 */

import type { AuthUser } from '../domain/auth-user';
import type { AuthRepository } from '../domain/auth-repository';
import { FirebaseAuthRepository } from '../infrastructure/firebase-auth-repository';

/**
 * RF-08: exigir e-mail verificado para entrar.
 */
export const REQUIRE_EMAIL_VERIFIED = true;

export type AuthErrorCode =
  | 'invalid-credentials'
  | 'account-disabled'
  | 'email-not-verified'
  | 'email-in-use'
  | 'weak-password'
  | 'too-many-attempts'
  | 'network'
  | 'auth-not-configured'
  | 'unauthorized-domain'
  | 'service-unavailable';

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

// RF-04: por segurança, e-mail/senha incorretos compartilham a MESMA mensagem
// (não revelamos se o e-mail existe).
const MESSAGES: Record<AuthErrorCode, string> = {
  'invalid-credentials': 'Não foi possível entrar. Confira o e-mail e a senha.',
  'account-disabled': 'Esta conta está desativada. Fale com o suporte.',
  'email-not-verified': 'Confirme seu e-mail antes de entrar. Reenviamos o link de verificação.',
  'email-in-use': 'Este e-mail já possui uma conta. Tente entrar.',
  'weak-password': 'A senha deve ter pelo menos 6 caracteres.',
  'too-many-attempts': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  network: 'Sem conexão. Verifique sua internet e tente novamente.',
  'auth-not-configured': 'Cadastro indisponível: o acesso por e-mail/senha não está ativo neste projeto Firebase.',
  'unauthorized-domain': 'Este domínio não está autorizado no Firebase para autenticação.',
  'service-unavailable': 'Serviço temporariamente indisponível. Tente mais tarde.',
};

export function authMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

// Instância do repositório de autenticação.
// Único ponto de dependência da infraestrutura Firebase nesta camada.
const authRepository: AuthRepository = new FirebaseAuthRepository();

// RF-05: garante persistência antes de operações que dependem dela.
const persistenceReady = authRepository.ensurePersistence().catch(() => {
  /* se falhar, a implementação mantém a persistência padrão */
});

export async function signIn(email: string, password: string): Promise<void> {
  await persistenceReady;
  try {
    const user = await authRepository.signIn(email, password);
    if (REQUIRE_EMAIL_VERIFIED && !user.emailVerified) {
      try {
        await authRepository.resendVerification();
      } catch {
        /* ignora falha ao reenviar */
      }
      await authRepository.signOut();
      throw new AuthError('email-not-verified');
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('service-unavailable');
  }
}

/**
 * RF-06: envia o e-mail de recuperação. Por segurança, NÃO revela se o e-mail
 * existe — erros de "usuário não encontrado" são silenciados; a UI mostra
 * sempre a mesma mensagem genérica. Só relança falhas de rede/limite.
 */
export async function sendReset(email: string): Promise<void> {
  await persistenceReady;
  try {
    await authRepository.sendResetEmail(email);
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'too-many-attempts') throw err;
      if (err.code === 'network') throw err;
    }
    /* user-not-found / invalid-email: silencioso (mensagem genérica na UI) */
  }
}

/**
 * RF-07: cria a conta, guarda o nome e dispara o e-mail de verificação.
 * O Firebase já deixa o novo usuário autenticado, mas como o e-mail ainda não
 * foi confirmado, `isAuthenticated` retorna false e o painel continua protegido
 * até a verificação (RF-08).
 */
export async function signUp(name: string, email: string, password: string): Promise<void> {
  await persistenceReady;
  try {
    await authRepository.signUp(name, email, password);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('service-unavailable');
  }
}

/** RF-08: reenvia o e-mail de verificação para o usuário atual. */
export async function resendVerification(): Promise<void> {
  try {
    await authRepository.resendVerification();
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'too-many-attempts') throw err;
    }
    throw new AuthError('service-unavailable');
  }
}

/** RF-08: recarrega o usuário e informa se o e-mail já foi verificado. */
export async function reloadAndCheckVerified(): Promise<boolean> {
  return authRepository.reloadAndCheckVerified();
}

/** E-mail do usuário autenticado no momento (para a tela de verificação). */
export function currentEmail(): string | null {
  return authRepository.getCurrentUser()?.email ?? null;
}

/** uid do usuário autenticado no momento (para escopar os dados por dono). */
export function currentUid(): string | null {
  return authRepository.currentUid();
}

/** RF-09: encerra a sessão. */
export async function logout(): Promise<void> {
  await authRepository.signOut();
}

/** RF-10: observa o estado de autenticação (dispara no load e a cada mudança). */
export function observeAuth(callback: (user: AuthUser | null) => void): () => void {
  return authRepository.onAuthStateChanged(callback);
}

/** true quando há sessão válida (respeitando a exigência de verificação). */
export function isAuthenticated(user: AuthUser | null): boolean {
  return Boolean(user) && (!REQUIRE_EMAIL_VERIFIED || Boolean(user?.emailVerified));
}
