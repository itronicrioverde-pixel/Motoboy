/**
 * Caso de uso de Compartilhamento de Localização (aplicação).
 *
 * Gerencia tokens de compartilhamento e atualização de localização
 * para que clientes possam acompanhar o motoboy em tempo real.
 */

import type { ShareToken } from '../domain/tracking';
import type { FirestoreSharingRepository } from '../infrastructure/firestore-sharing';
import type { GpsMonitor } from '../infrastructure/gps-monitor';
import type { TrackingState } from '../domain/tracking';

export interface SharingState {
  readonly isSharing: boolean;
  readonly token: string | null;
  readonly shareUrl: string | null;
}

export class SharingService {
  private shareToken: ShareToken | null = null;
  private sharingGpsMonitor: GpsMonitor | null = null;
  private onStateChange: (() => void) | null = null;

  constructor(
    private readonly sharingRepo: FirestoreSharingRepository,
    private readonly createGpsMonitor: () => GpsMonitor,
    private readonly getBaseUrl: () => string,
  ) {}

  /** Registra callback para mudanças de estado. */
  subscribe(callback: () => void): () => void {
    this.onStateChange = callback;
    return () => { this.onStateChange = null; };
  }

  private notify(): void {
    this.onStateChange?.();
  }

  /** Estado atual do compartilhamento. */
  getState(): SharingState {
    return {
      isSharing: this.shareToken !== null,
      token: this.shareToken?.token ?? null,
      shareUrl: this.shareToken ? `${this.getBaseUrl()}/compartilhar/${this.shareToken.token}` : null,
    };
  }

  /**
   * Inicia o compartilhamento de localização para uma rota.
   * Cria token no Firestore e começa a enviar localização.
   */
  async startSharing(routeId: string): Promise<string | null> {
    if (this.shareToken) return this.shareToken.token;

    try {
      const token = await this.sharingRepo.createToken(routeId);
      this.shareToken = token;

      // Inicia GPS para compartilhamento separado
      this.sharingGpsMonitor = this.createGpsMonitor();
      this.sharingGpsMonitor.start(
        async (state) => {
          await this.sendLocation(state);
        },
      );

      this.notify();
      return token.token;
    } catch {
      return null;
    }
  }

  /** Para o compartilhamento. */
  async stopSharing(): Promise<void> {
    if (!this.shareToken) return;

    this.sharingGpsMonitor?.stop();
    this.sharingGpsMonitor = null;

    try {
      await this.sharingRepo.removeToken(this.shareToken.token);
    } catch {
      /* best effort */
    }

    this.shareToken = null;
    this.notify();
  }

  /** Envia localização atual para o Firestore. */
  private async sendLocation(state: TrackingState): Promise<void> {
    if (!this.shareToken) return;

    try {
      await this.sharingRepo.updateLocation(
        this.shareToken.token,
        state.position,
        state.heading,
        state.speed,
      );
    } catch {
      /* offline/erro: ignora */
    }
  }

  /** Atualiza dados da rota para o cliente. */
  async updateRouteData(data: {
    waypoints: readonly { label: string; address: string; lat: number; lon: number; type: string; status: string }[];
    etaMinutes: number;
    distanceRemainingKm: number;
  }): Promise<void> {
    if (!this.shareToken) return;

    try {
      await this.sharingRepo.updateRouteData(this.shareToken.token, {
        routeId: this.shareToken.routeId,
        startedAt: this.shareToken.createdAt,
        waypoints: data.waypoints,
        etaMinutes: data.etaMinutes,
        distanceRemainingKm: data.distanceRemainingKm,
      });
    } catch {
      /* offline/erro: ignora */
    }
  }

  /** Valida e recupera um token existente. */
  async validateToken(token: string): Promise<ShareToken | null> {
    return this.sharingRepo.validateToken(token);
  }

  /** Cleanup de tokens expirados. */
  async cleanExpired(): Promise<void> {
    return this.sharingRepo.cleanExpiredTokens();
  }
}
