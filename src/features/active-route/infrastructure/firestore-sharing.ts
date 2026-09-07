/**
 * Infraestrutura de compartilhamento via Firestore.
 *
 * Armazena tokens de compartilhamento e localização em tempo real
 * para que clientes possam acompanhar a posição do motoboy.
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../../../config/firebase.js';
import type { ShareToken } from '../domain/tracking';
import type { GeoPoint } from '../../mapa/domain/routing';

export interface ShareLocationData {
  readonly lat: number;
  readonly lon: number;
  readonly heading: number | null;
  readonly speed: number | null;
  readonly updatedAt: string;
}

export interface ShareRouteData {
  readonly routeId: string;
  readonly startedAt: string;
  readonly waypoints: readonly {
    readonly label: string;
    readonly address: string;
    readonly lat: number;
    readonly lon: number;
    readonly type: string;
    readonly status: string;
  }[];
  readonly etaMinutes: number;
  readonly distanceRemainingKm: number;
}

function getShareCollection(uid: string) {
  return collection(db, 'users', uid, 'share-tokens');
}

function getShareDoc(uid: string, token: string) {
  return doc(db, 'users', uid, 'share-tokens', token);
}

function getShareLocationDoc(uid: string, token: string) {
  return doc(db, 'users', uid, 'share-locations', token);
}

function getShareRouteDoc(uid: string, token: string) {
  return doc(db, 'users', uid, 'share-routes', token);
}

/** Gera um token aleatório seguro. */
function generateToken(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class FirestoreSharingRepository {
  constructor(private readonly getUid: () => string | null) {}

  /** Cria um token de compartilhamento. */
  async createToken(routeId: string, ttlHours = 24): Promise<ShareToken> {
    const uid = this.getUid();
    if (!uid) throw new Error('Sem usuário autenticado.');

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    const data: ShareToken & DocumentData = {
      token,
      routeId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await setDoc(getShareDoc(uid, token), data);
    return data;
  }

  /** Valida um token (não expirado). */
  async validateToken(token: string): Promise<ShareToken | null> {
    const uid = this.getUid();
    if (!uid) return null;

    try {
      const snap = await getDoc(getShareDoc(uid, token));
      if (!snap.exists()) return null;

      const data = snap.data() as ShareToken;
      if (new Date(data.expiresAt) < new Date()) {
        await this.removeToken(token);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /** Remove um token. */
  async removeToken(token: string): Promise<void> {
    const uid = this.getUid();
    if (!uid) return;

    try {
      await deleteDoc(getShareDoc(uid, token));
      // Remove dados associados
      await deleteDoc(getShareLocationDoc(uid, token)).catch(() => {});
      await deleteDoc(getShareRouteDoc(uid, token)).catch(() => {});
    } catch {
      /* best effort */
    }
  }

  /** Atualiza a localização atual para um token. */
  async updateLocation(token: string, position: GeoPoint, heading: number | null, speed: number | null): Promise<void> {
    const uid = this.getUid();
    if (!uid) return;

    const data: ShareLocationData & DocumentData = {
      lat: position.lat,
      lon: position.lon,
      heading,
      speed,
      updatedAt: new Date().toISOString(),
    };

    await setDoc(getShareLocationDoc(uid, token), data, { merge: true });
  }

  /** Atualiza os dados da rota para um token. */
  async updateRouteData(token: string, routeData: ShareRouteData): Promise<void> {
    const uid = this.getUid();
    if (!uid) return;

    await setDoc(getShareRouteDoc(uid, token), routeData, { merge: true });
  }

  /** Remove tokens expirados (cleanup). */
  async cleanExpiredTokens(): Promise<void> {
    const uid = this.getUid();
    if (!uid) return;

    try {
      const snap = await getDocs(getShareCollection(uid));
      const now = new Date();
      for (const docSnap of snap.docs) {
        const data = docSnap.data() as ShareToken;
        if (new Date(data.expiresAt) < now) {
          await deleteDoc(docSnap.ref);
        }
      }
    } catch {
      /* best effort */
    }
  }

  /** Lê a localização de um token (para uso público). */
  async readLocation(_token: string): Promise<ShareLocationData | null> {
    // Para leitura pública, precisamos de um repositório separado sem auth
    // Por enquanto, retorna null (será implementado com Cloud Function ou regra pública)
    return null;
  }
}
