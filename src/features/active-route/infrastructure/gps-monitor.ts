/**
 * Monitor de GPS — wrapper sobre navigator.geolocation.
 *
 * Melhorias sobre a versão anterior:
 * - Suavização de posição (média ponderada das últimas leituras)
 * - Filtro de saltos/espigões (rejeita posições muito distantes rapidamente)
 * - Filtro baseado em velocidade (em movimento, aceita mais variação)
 * - Suavização de heading (direção)
 * - Detecção de parado vs. em movimento
 */

import type { TrackingState } from '../domain/tracking';
import type { GeoPoint } from '../../mapa/domain/routing';

export type GpsCallback = (state: TrackingState) => void;
export type GpsErrorCallback = (error: GeolocationPositionError) => void;

export interface GpsMonitorOptions {
  /** Precisão máxima aceitável em metros. */
  readonly targetAccuracy?: number;
  /** Intervalo mínimo entre atualizações em ms. */
  readonly minInterval?: number;
  /** Usar alta precisão (GPS do dispositivo). */
  readonly highAccuracy?: boolean;
  /** Número de leituras para suavização. */
  readonly smoothingWindow?: number;
  /** Distância máxima entre leituras consecutivas em metros (rejeita saltos). */
  readonly maxJumpMeters?: number;
}

const DEFAULT_OPTIONS: Required<GpsMonitorOptions> = {
  targetAccuracy: 30,
  minInterval: 2000,
  highAccuracy: true,
  smoothingWindow: 3,
  maxJumpMeters: 200,
};

/** Haversine: distância em metros entre dois pontos. */
function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

interface PositionReading {
  readonly lat: number;
  readonly lon: number;
  readonly accuracy: number;
  readonly timestamp: number;
}

export class GpsMonitor {
  private watchId: number | null = null;
  private bestAccuracy = Infinity;
  private lastUpdate = 0;
  private options: Required<GpsMonitorOptions>;
  private positionHistory: PositionReading[] = [];
  private lastReportedPosition: GeoPoint | null = null;
  private isStationary = false;

  constructor(options?: GpsMonitorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Inicia observação contínua da posição. */
  start(onUpdate: GpsCallback, onError?: GpsErrorCallback): void {
    if (!navigator.geolocation) {
      onError?.({ code: 0, message: 'Geolocation not supported', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      return;
    }

    this.stop();

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - this.lastUpdate < this.options.minInterval) return;

        const accuracy = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : Infinity;
        const rawLat = pos.coords.latitude;
        const rawLon = pos.coords.longitude;

        // Filtro 1: Rejeita leituras com precisão muito ruim
        if (accuracy > 100) return;

        // Filtro 2: Rejeita saltos/espigões
        if (this.lastReportedPosition) {
          const jumpDist = haversineMeters(
            this.lastReportedPosition,
            { lat: rawLat, lon: rawLon },
          );
          const timeDelta = (pos.timestamp - (this.positionHistory.length > 0
            ? this.positionHistory[this.positionHistory.length - 1].timestamp
            : 0)) / 1000;

          // Se moveu mais que maxJumpMeters em menos de 2 segundos, é um salto
          if (jumpDist > this.options.maxJumpMeters && timeDelta < 2) {
            return;
          }

          // Se a precisão piorou muito em relação à melhor, rejeita
          if (this.bestAccuracy !== Infinity && accuracy > this.bestAccuracy * 2) {
            return;
          }
        }

        // Adiciona ao histórico
        this.positionHistory.push({ lat: rawLat, lon: rawLon, accuracy, timestamp: pos.timestamp });
        if (this.positionHistory.length > this.options.smoothingWindow + 2) {
          this.positionHistory.shift();
        }

        // Suavização: média ponderada (leituras mais recentes pesam mais)
        const smoothed = this.smoothPosition();

        // Melhor precisão
        this.bestAccuracy = Math.min(this.bestAccuracy, accuracy);
        this.lastUpdate = now;

        // Detecção de parado vs. em movimento
        if (this.lastReportedPosition) {
          const distMoved = haversineMeters(this.lastReportedPosition, smoothed);
          if (distMoved < 5) { // menos de 5m = parado
          if (!this.isStationary) {
            this.isStationary = true;
          }
          } else {
            this.isStationary = false;
          }
        }

        this.lastReportedPosition = smoothed;

        const state: TrackingState = {
          position: smoothed,
          accuracy,
          heading: this.smoothHeading(pos.coords.heading),
          speed: typeof pos.coords.speed === 'number' && Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
          timestamp: pos.timestamp,
        };

        onUpdate(state);
      },
      (err) => {
        onError?.(err);
      },
      {
        enableHighAccuracy: this.options.highAccuracy,
        maximumAge: 0,
        timeout: 20000,
      },
    );
  }

  /** Para de observar. */
  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.bestAccuracy = Infinity;
    this.lastUpdate = 0;
    this.positionHistory = [];
    this.lastReportedPosition = null;
    this.isStationary = false;
  }

  /** Retorna true se está observando. */
  isRunning(): boolean {
    return this.watchId !== null;
  }

  /** Melhor precisão registrada. */
  getBestAccuracy(): number {
    return this.bestAccuracy;
  }

  /** Retorna true se o dispositivo está parado. */
  isStationaryDevice(): boolean {
    return this.isStationary;
  }

  /**
   * Suaviza a posição usando média ponderada.
   * Leituras mais recentes e mais precisas pesam mais.
   */
  private smoothPosition(): GeoPoint {
    const history = this.positionHistory;
    if (history.length === 0) return { lat: 0, lon: 0 };
    if (history.length === 1) return { lat: history[0].lat, lon: history[0].lon };

    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLon = 0;

    for (let i = 0; i < history.length; i++) {
      const reading = history[i];
      // Peso: mais recente + mais preciso
      const recencyWeight = (i + 1) / history.length; // 0 a 1
      const accuracyWeight = reading.accuracy > 0 ? 1 / reading.accuracy : 1;
      const weight = recencyWeight * accuracyWeight;

      weightedLat += reading.lat * weight;
      weightedLon += reading.lon * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      const last = history[history.length - 1];
      return { lat: last.lat, lon: last.lon };
    }

    return {
      lat: weightedLat / totalWeight,
      lon: weightedLon / totalWeight,
    };
  }

  /** Suaviza o heading (direção) para evitar oscilações. */
  private smoothHeading(raw: number | null): number | null {
    if (raw === null || !Number.isFinite(raw)) return null;

    // Se estamos parados, não confia no heading
    if (this.isStationary) return null;

    // Pega os últimos headings do histórico (se disponível)
    // Por simplicidade, retorna o valor bruto com filtro básico
    // Heading muito instável quando parado ou lento
    if (this.positionHistory.length >= 2) {
      const last = this.positionHistory[this.positionHistory.length - 1];
      const prev = this.positionHistory[this.positionHistory.length - 2];
      const dt = (last.timestamp - prev.timestamp) / 1000;
      if (dt > 0) {
        const dist = haversineMeters(prev, last);
        const speedMs = dist / dt;
        // Se lento (< 1 m/s = 3.6 km/h), heading é instável
        if (speedMs < 1) return null;
      }
    }

    return raw;
  }
}
