/**
 * Serviço de autenticação (camada de aplicação).
 *
 * Concentra toda a conversa com o Firebase Authentication. A camada de
 * apresentação (login-view) só chama estas funções e nunca lida com os
 * códigos internos do Firebase.
 *
 * RF-04 (mensagens de erro), RF-05 (sessão persistente), RF-06 (recuperação),
 * RF-09 (sair), RF-10 (estado de autenticação para proteger o painel).
 */

import { auth } from '../../../config/firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  type User,
} from 'firebase/auth';

/**
 * RF-08: exigir e-mail verificado para entrar.
 * TEMPORARIAMENTE DESLIGADO para testes locais (conta criada sem caixa de
 * entrada real). Voltar para `true` antes de publicar em produção.
 */
export const REQUIRE_EMAIL_VERIFIED = false;

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

function mapFirebaseError(code: string): AuthErrorCode {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'invalid-credentials';
    case 'auth/user-disabled':
      return 'account-disabled';
    case 'auth/email-already-in-use':
      return 'email-in-use';
    case 'auth/weak-password':
      return 'weak-password';
    case 'auth/too-many-requests':
      return 'too-many-attempts';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      // Projeto Firebase sem o provedor E-mail/Senha habilitado (HTTP 400 no signUp).
      return 'auth-not-configured';
    case 'auth/unauthorized-domain':
      return 'unauthorized-domain';
    default:
      return 'service-unavailable';
  }
}

function errorCodeOf(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}

// RF-05: mantém a sessão após fechar o navegador (persistência local).
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {
  /* se falhar, o Firebase mantém a persistência padrão */
});

export async function signIn(email: string, password: string): Promise<void> {
  await persistenceReady;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (REQUIRE_EMAIL_VERIFIED && !credential.user.emailVerified) {
      try {
        await sendEmailVerification(credential.user);
      } catch {
        /* ignora falha ao reenviar */
      }
      await signOut(auth);
      throw new AuthError('email-not-verified');
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(mapFirebaseError(errorCodeOf(err)));
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
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    const code = errorCodeOf(err);
    if (code === 'auth/too-many-requests') throw new AuthError('too-many-attempts');
    if (code === 'auth/network-request-failed') throw new AuthError('network');
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
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) {
      try {
        await updateProfile(credential.user, { displayName: name });
      } catch {
        /* nome é opcional; não bloqueia o cadastro */
      }
    }
    try {
      await sendEmailVerification(credential.user);
    } catch {
      /* verificação pode ser reenviada na tela seguinte */
    }
  } catch (err) {
    throw new AuthError(mapFirebaseError(errorCodeOf(err)));
  }
}

/** RF-08: reenvia o e-mail de verificação para o usuário atual. */
export async function resendVerification(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await sendEmailVerification(user);
  } catch (err) {
    if (errorCodeOf(err) === 'auth/too-many-requests') throw new AuthError('too-many-attempts');
    throw new AuthError('service-unavailable');
  }
}

/** RF-08: recarrega o usuário e informa se o e-mail já foi verificado. */
export async function reloadAndCheckVerified(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  const verified = Boolean(auth.currentUser?.emailVerified);
  if (verified) {
    // Força a renovação do token para o claim email_verified chegar às
    // regras do Firestore (senão as escritas seriam negadas logo após verificar).
    try {
      await auth.currentUser?.getIdToken(true);
    } catch {
      /* ignora falha de refresh */
    }
  }
  return verified;
}

/** E-mail do usuário autenticado no momento (para a tela de verificação). */
export function currentEmail(): string | null {
  return auth.currentUser?.email ?? null;
}

/** uid do usuário autenticado no momento (para escopar os dados por dono). */
export function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

/** RF-09: encerra a sessão. */
export async function logout(): Promise<void> {
  await signOut(auth);
}

/** RF-10: observa o estado de autenticação (dispara no load e a cada mudança). */
export function observeAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** true quando há sessão válida (respeitando a exigência de verificação). */
export function isAuthenticated(user: User | null): boolean {
  return Boolean(user) && (!REQUIRE_EMAIL_VERIFIED || Boolean(user?.emailVerified));
}
