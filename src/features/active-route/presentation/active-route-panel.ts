/**
 * Painel de Rota Ativa (apresentação).
 *
 * Exibe: ETA, distância restante, progresso, botões de ação.
 * Estilo similar ao painel lateral do Uber/99 durante corrida.
 */

import type { RouteProgress, ActiveRoute, Waypoint } from '../domain/tracking';

export interface ActiveRoutePanelCallbacks {
  readonly onCompleteStop: () => void;
  readonly onSkipStop: () => void;
  readonly onOptimize: () => void;
  readonly onShare: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')}km`;
}

function waypointStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✓';
    case 'current': return '●';
    case 'skipped': return '○';
    default: return '○';
  }
}

function waypointTypeLabel(type: string): string {
  return type === 'pickup' ? 'Coleta' : 'Entrega';
}

export class ActiveRoutePanel {
  private container: HTMLElement | null = null;
  private callbacks: ActiveRoutePanelCallbacks;
  private isPaused = false;

  constructor(callbacks: ActiveRoutePanelCallbacks) {
    this.callbacks = callbacks;
  }

  /** Monta o painel no DOM. */
  mount(target: HTMLElement): void {
    this.container = target;
    this.render();
  }

  /** Desmonta o painel. */
  unmount(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  /** Atualiza o painel com novos dados. */
  update(progress: RouteProgress | null, route: ActiveRoute | null): void {
    if (!this.container) return;

    const etaEl = this.container.querySelector('#arp-eta');
    const distEl = this.container.querySelector('#arp-distance');
    const progressEl = this.container.querySelector('#arp-progress-fill') as HTMLElement;
    const progressTextEl = this.container.querySelector('#arp-progress-text');
    const stopsEl = this.container.querySelector('#arp-stops-list');
    const pauseBtn = this.container.querySelector('#arp-pause-btn') as HTMLButtonElement;

    if (etaEl && progress) etaEl.textContent = progress.ETA;
    if (distEl && progress) distEl.textContent = formatDistance(progress.distanceRemainingMeters);
    if (progressEl && progress) progressEl.style.width = `${progress.percentComplete}%`;
    if (progressTextEl && progress) progressTextEl.textContent = `${progress.percentComplete}% concluído`;

    if (pauseBtn) {
      this.isPaused = route?.status === 'paused';
      pauseBtn.textContent = this.isPaused ? '▶ Retomar' : '⏸ Pausar';
      pauseBtn.className = this.isPaused ? 'arp-btn arp-btn-primary' : 'arp-btn arp-btn-secondary';
    }

    if (stopsEl && route) {
      stopsEl.innerHTML = this.renderStopsList(route.waypoints, route.currentWaypointIndex);
    }
  }

  /** Atualiza a instrução de navegação atual. */
  updateNavigationStep(text: string | null): void {
    if (!this.container) return;
    const stepEl = this.container.querySelector('#arp-current-step');
    if (stepEl) {
      stepEl.textContent = text ?? 'Siga em frente';
    }
  }

  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="arp-panel">
        <div class="arp-header">
          <div class="arp-header-info">
            <div class="arp-eta-row">
              <span class="arp-eta" id="arp-eta">--</span>
              <span class="arp-eta-label">chegada estimada</span>
            </div>
            <div class="arp-distance-row">
              <span class="arp-distance" id="arp-distance">--</span>
              <span class="arp-distance-label">restante</span>
            </div>
          </div>
          <div class="arp-progress-bar">
            <div class="arp-progress-fill" id="arp-progress-fill" style="width:0%"></div>
          </div>
          <div class="arp-progress-text" id="arp-progress-text">0% concluído</div>
        </div>

        <div class="arp-nav-step" id="arp-nav-step">
          <div class="arp-nav-icon">↗</div>
          <div class="arp-nav-text" id="arp-current-step">Siga em frente</div>
        </div>

        <div class="arp-stops">
          <div class="arp-stops-title">PARADAS</div>
          <div class="arp-stops-list" id="arp-stops-list"></div>
        </div>

        <div class="arp-actions">
          <button type="button" class="arp-btn arp-btn-primary" id="arp-complete-btn">
            ✓ Entrega Realizada
          </button>
          <button type="button" class="arp-btn arp-btn-secondary" id="arp-skip-btn">
            Pular Parada
          </button>
        </div>

        <div class="arp-secondary-actions">
          <button type="button" class="arp-btn arp-btn-outline" id="arp-optimize-btn">
            🔄 Otimizar Rota
          </button>
          <button type="button" class="arp-btn arp-btn-outline" id="arp-share-btn">
            📤 Compartilhar
          </button>
          <button type="button" class="arp-btn arp-btn-outline arp-btn-pause" id="arp-pause-btn">
            ⏸ Pausar
          </button>
          <button type="button" class="arp-btn arp-btn-danger" id="arp-stop-btn">
            ⏹ Parar Rota
          </button>
        </div>
      </div>
    `;

    // Event listeners
    this.container.querySelector('#arp-complete-btn')?.addEventListener('click', () => {
      this.callbacks.onCompleteStop();
    });

    this.container.querySelector('#arp-skip-btn')?.addEventListener('click', () => {
      this.callbacks.onSkipStop();
    });

    this.container.querySelector('#arp-optimize-btn')?.addEventListener('click', () => {
      this.callbacks.onOptimize();
    });

    this.container.querySelector('#arp-share-btn')?.addEventListener('click', () => {
      this.callbacks.onShare();
    });

    this.container.querySelector('#arp-pause-btn')?.addEventListener('click', () => {
      if (this.isPaused) {
        this.callbacks.onResume();
      } else {
        this.callbacks.onPause();
      }
    });

    this.container.querySelector('#arp-stop-btn')?.addEventListener('click', () => {
      this.callbacks.onStop();
    });
  }

  private renderStopsList(waypoints: readonly Waypoint[], currentIndex: number): string {
    return waypoints.map((w, i) => {
      const icon = waypointStatusIcon(w.status);
      const label = waypointTypeLabel(w.type);
      const isActive = i === currentIndex;
      const statusClass = w.status === 'completed' ? 'completed' :
                         w.status === 'skipped' ? 'skipped' :
                         isActive ? 'current' : 'pending';

      return `
        <div class="arp-stop-item ${statusClass}">
          <span class="arp-stop-icon">${icon}</span>
          <div class="arp-stop-info">
            <div class="arp-stop-label">${label} #${i + 1}</div>
            <div class="arp-stop-address">${w.address || w.label}</div>
          </div>
          ${w.value > 0 ? `<span class="arp-stop-value">R$ ${w.value.toFixed(2).replace('.', ',')}</span>` : ''}
        </div>
      `;
    }).join('');
  }
}
