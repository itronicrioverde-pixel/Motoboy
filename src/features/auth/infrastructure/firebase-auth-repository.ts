/**
 * Implementação Firebase da porta AuthRepository.
 *
 * Este é o ÚNICO arquivo que importa firebase/auth.
 * Toda a camada application e domain depende da interface, não desta implementação.
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
import type { AuthRepository, Unsubscribe } from '../domain/auth-repository';
import type { AuthUser } from '../domain/auth-user';

/** Converte o User do Firebase para o tipo de domínio AuthUser. */
function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}

export class FirebaseAuthRepository implements AuthRepository {
  private persistenceReady: Promise<void>;

  constructor() {
    this.persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {
      /* se falhar, o Firebase mantém a persistência padrão */
    });
  }

  async ensurePersistence(): Promise<void> {
    await this.persistenceReady;
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    await this.ensurePersistence();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return toAuthUser(credential.user);
  }

  async signUp(name: string, email: string, password: string): Promise<AuthUser> {
    await this.ensurePersistence();
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
    return toAuthUser(credential.user);
  }

  async sendResetEmail(email: string): Promise<void> {
    await this.ensurePersistence();
    await sendPasswordResetEmail(auth, email);
  }

  async resendVerification(): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    await sendEmailVerification(user);
  }

  async reloadAndCheckVerified(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;
    await user.reload();
    const verified = Boolean(auth.currentUser?.emailVerified);
    if (verified) {
      try {
        await auth.currentUser?.getIdToken(true);
      } catch {
        /* ignora falha de refresh */
      }
    }
    return verified;
  }

  async signOut(): Promise<void> {
    await signOut(auth);
  }

  getCurrentUser(): AuthUser | null {
    const user = auth.currentUser;
    return user ? toAuthUser(user) : null;
  }

  currentUid(): string | null {
    return auth.currentUser?.uid ?? null;
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void): Unsubscribe {
    return onAuthStateChanged(auth, (user) => {
      callback(user ? toAuthUser(user) : null);
    });
  }
}
