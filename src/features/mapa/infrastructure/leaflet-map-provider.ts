/**
 * Provedor de mapa usando Leaflet.js + OpenStreetMap.
 *
 * Gratuito, sem chave, sem limite de uso.
 * Renderiza mapa interativo com marcadores, rotas (polylines) e círculos.
 */

import 'leaflet/dist/leaflet.css';
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

/** Informações de uma rota para exibir no mapa (linha reta entre dois pontos). */
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
  private positionMarker: L.Marker | null = null;
  private positionAccuracyCircle: L.Circle | null = null;

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

    // Força recálculo de tiles (necessário quando container estava oculto)
    setTimeout(() => this.map?.invalidateSize(), 50);
    setTimeout(() => this.map?.invalidateSize(), 300);
  }

  /** Força recálculo de tiles (útil quando o container fica visível após estar oculto). */
  invalidateSize(): void {
    if (!this.map) return;
    this.map.invalidateSize();
  }

  /** Centraliza o mapa em um ponto, forçando redesenho. */
  setCenter(point: GeoPoint, zoom?: number): void {
    if (!this.map) return;
    this.map.setView([point.lat, point.lon], zoom ?? this.map.getZoom(), { animate: false });
    // Força recálculo de tiles após mudança de centro
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  /** Adiciona um marcador no mapa. */
  addMarker(point: GeoPoint, label?: string, options?: { color?: string; draggable?: boolean }): void {
    if (!this.map) return;

    const markerOptions: L.MarkerOptions = {};
    if (options?.draggable) {
      markerOptions.draggable = true;
    }

    const marker = L.marker([point.lat, point.lon], markerOptions).addTo(this.map);
    if (label) marker.bindPopup(label);
    this.markers.push(marker);
  }

  /** Adiciona marcador numerado (para paradas). */
  addNumberedMarker(point: GeoPoint, number: number, label?: string): void {
    if (!this.map) return;

    const icon = L.divIcon({
      className: 'route-marker-numbered',
      html: `<div style="
        background:#3388ff;color:#fff;border-radius:50%;
        width:28px;height:28px;display:flex;align-items:center;justify-content:center;
        font-weight:bold;font-size:13px;border:2px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,.35);
      ">${number}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const marker = L.marker([point.lat, point.lon], { icon }).addTo(this.map);
    if (label) marker.bindPopup(label);
    this.markers.push(marker);
  }

  /** Remove todos os marcadores. */
  clearMarkers(): void {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
  }

  /** Desenha uma rota (linha reta) entre dois pontos. */
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

  /** Desenha uma polyline a partir de um array de coordenadas (rota real do OSRM). */
  drawPolyline(
    coordinates: GeoPoint[],
    options?: { color?: string; weight?: number; opacity?: number },
  ): void {
    if (!this.map || coordinates.length < 2) return;

    const latLngs: L.LatLngExpression[] = coordinates.map((p) => [p.lat, p.lon]);
    const line = L.polyline(latLngs, {
      color: options?.color ?? '#3388ff',
      weight: options?.weight ?? 4,
      opacity: options?.opacity ?? 0.85,
    }).addTo(this.map);

    this.routeLines.push(line);
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

  /** Ajusta o mapa para mostrar todos os marcadores e rotas. */
  fitAll(): void {
    if (!this.map) return;
    const allLatLngs: L.LatLngExpression[] = [];

    this.markers.forEach((m) => {
      const ll = m.getLatLng();
      allLatLngs.push([ll.lat, ll.lng]);
    });

    this.routeLines.forEach((line) => {
      const ll = line.getLatLngs();
      if (Array.isArray(ll)) {
        ll.forEach((p) => {
          if ('lat' in p && 'lng' in p) {
            allLatLngs.push([p.lat, p.lng]);
          }
        });
      }
    });

    if (allLatLngs.length === 0) return;
    const bounds = L.latLngBounds(allLatLngs);
    this.map.fitBounds(bounds, { padding: [50, 50] });
  }

  /** Adiciona ou atualiza o marcador de posição do motoboy (pulsante). */
  addPositionMarker(point: GeoPoint, accuracy?: number): void {
    if (!this.map) return;

    const icon = L.divIcon({
      className: 'position-marker',
      html: `<div class="position-marker-dot"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    if (this.positionMarker) {
      this.positionMarker.setLatLng([point.lat, point.lon]);
      this.positionMarker.setIcon(icon);
    } else {
      this.positionMarker = L.marker([point.lat, point.lon], { icon, zIndexOffset: 1000 }).addTo(this.map);
    }

    if (typeof accuracy === 'number' && accuracy > 0) {
      if (this.positionAccuracyCircle) {
        this.positionAccuracyCircle.setLatLng([point.lat, point.lon]);
        this.positionAccuracyCircle.setRadius(accuracy);
      } else {
        this.positionAccuracyCircle = L.circle([point.lat, point.lon], {
          radius: accuracy,
          color: '#3388ff',
          fillColor: '#3388ff',
          fillOpacity: 0.08,
          weight: 0,
        }).addTo(this.map);
      }
    }
  }

  /** Centraliza o mapa na posição atual com animação suave. */
  centerOnPosition(point: GeoPoint, zoom?: number): void {
    if (!this.map) return;
    this.map.flyTo([point.lat, point.lon], zoom ?? this.map.getZoom(), {
      duration: 0.8,
      animate: true,
    });
  }

  /** Remove o marcador de posição. */
  removePositionMarker(): void {
    if (this.positionMarker) {
      this.positionMarker.remove();
      this.positionMarker = null;
    }
    if (this.positionAccuracyCircle) {
      this.positionAccuracyCircle.remove();
      this.positionAccuracyCircle = null;
    }
  }

  /** Destrói o mapa e libera recursos. */
  destroy(): void {
    this.clearMarkers();
    this.clearRoutes();
    this.removePositionMarker();
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
