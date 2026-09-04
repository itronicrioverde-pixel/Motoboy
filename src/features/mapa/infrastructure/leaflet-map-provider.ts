/**
 * Provedor de mapa usando Leaflet.js + OpenStreetMap.
 *
 * Gratuito, sem chave, sem limite de uso.
 * Renderiza mapa interativo com marcadores, rotas e círculos.
 */

import L from 'leaflet';
import type { GeoPoint } from '../domain/routing';

/** Configuração do mapa. */
export interface MapConfig {
  /** Elemento HTML onde o mapa será renderizado. */
  readonly container: HTMLElement;
  /** Centro inicial do mapa. */
  readonly center: GeoPoint;
  /** Nível de zoom inicial. */
  readonly zoom: number;
}

/** Informações de uma rota para exibir no mapa. */
export interface RouteDisplay {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly originLabel?: string;
  readonly destinationLabel?: string;
}

export class LeafletMapProvider {
  private map: L.Map | null = null;
  private markers: L.Marker[] = [];
  private routeLines: L.Polyline[] = [];

  /** Cria e renderiza o mapa. */
  create(config: MapConfig): void {
    if (this.map) this.destroy();

    this.map = L.map(config.container, {
      center: [config.center.lat, config.center.lon],
      zoom: config.zoom,
      zoomControl: true,
      attributionControl: true,
    });

    // Tiles do OpenStreetMap (gratuitas)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);
  }

  /** Centraliza o mapa em um ponto. */
  setCenter(point: GeoPoint, zoom?: number): void {
    if (!this.map) return;
    this.map.setView([point.lat, point.lon], zoom ?? this.map.getZoom());
  }

  /** Adiciona um marcador no mapa. */
  addMarker(point: GeoPoint, label?: string): void {
    if (!this.map) return;
    const marker = L.marker([point.lat, point.lon]).addTo(this.map);
    if (label) marker.bindPopup(label);
    this.markers.push(marker);
  }

  /** Remove todos os marcadores. */
  clearMarkers(): void {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
  }

  /** Desenha uma rota (linha) entre dois pontos. */
  drawRoute(display: RouteDisplay): void {
    if (!this.map) return;
    const line = L.polyline(
      [
        [display.origin.lat, display.origin.lon],
        [display.destination.lat, display.destination.lon],
      ],
      { color: '#3388ff', weight: 3, opacity: 0.8 },
    ).addTo(this.map);

    if (display.originLabel) {
      L.marker([display.origin.lat, display.origin.lon])
        .addTo(this.map!)
        .bindPopup(display.originLabel)
        .openPopup();
    }
    if (display.destinationLabel) {
      L.marker([display.destination.lat, display.destination.lon])
        .addTo(this.map!)
        .bindPopup(display.destinationLabel);
    }

    this.routeLines.push(line);

    // Ajusta o zoom para mostrar a rota inteira
    const bounds = L.latLngBounds([
      [display.origin.lat, display.origin.lon],
      [display.destination.lat, display.destination.lon],
    ]);
    this.map.fitBounds(bounds, { padding: [50, 50] });
  }

  /** Remove todas as rotas. */
  clearRoutes(): void {
    this.routeLines.forEach((l) => l.remove());
    this.routeLines = [];
  }

  /** Ajusta o mapa para mostrar todos os marcadores. */
  fitAllMarkers(): void {
    if (!this.map || this.markers.length === 0) return;
    const group = L.featureGroup(this.markers);
    this.map.fitBounds(group.getBounds().pad(0.1));
  }

  /** Destrói o mapa e libera recursos. */
  destroy(): void {
    this.clearMarkers();
    this.clearRoutes();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  /** Retorna a instância Leaflet (para uso avançado). */
  getLeafletMap(): L.Map | null {
    return this.map;
  }
}
