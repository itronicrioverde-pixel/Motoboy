/**
 * HUD de Navegação (apresentação).
 *
 * Barra inferior estilo Waze/Google Maps com:
 * - Instrução de direção atual
 * - Ícone de manobra
 * - Distância até a próxima manobra
 */

import type { NavigationStep } from '../domain/tracking';

function maneuverIcon(step: NavigationStep): string {
  const { maneuverType, modifier } = step;

  if (maneuverType === 'roundabout' || maneuverType === 'rotary_name' || maneuverType === 'roundabout_turn') {
    return '🔄';
  }

  if (maneuverType === 'depart') return '📍';
  if (maneuverType === 'arrive') return '🏁';

  switch (modifier) {
    case 'left': return '⬅';
    case 'sharp left': return '↩';
    case 'slight left': return '↖';
    case 'right': return '➡';
    case 'sharp right': return '↪';
    case 'slight right': return '↗';
    case 'uturn': return '🔄';
    default: return '⬆';
  }
}

function formatStepDistance(meters: number): string {
  if (meters < 100) return 'agora';
  if (meters < 1000) return `em ${Math.round(meters)}m`;
  return `em ${(meters / 1000).toFixed(1).replace('.', ',')}km`;
}

export interface NavigationHudCallbacks {
  readonly onStopNavigation: () => void;
}

export class NavigationHud {
  private container: HTMLElement | null = null;
  private callbacks: NavigationHudCallbacks;

  constructor(callbacks: NavigationHudCallbacks) {
    this.callbacks = callbacks;
  }

  /** Monta o HUD no DOM. */
  mount(target: HTMLElement): void {
    this.container = target;
    this.render();
  }

  /** Desmonta o HUD. */
  unmount(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  /** Atualiza a instrução de navegação. */
  update(step: NavigationStep | null): void {
    if (!this.container) return;

    const iconEl = this.container.querySelector('#nhud-icon');
    const textEl = this.container.querySelector('#nhud-text');
    const distanceEl = this.container.querySelector('#nhud-distance');

    if (iconEl) iconEl.textContent = step ? maneuverIcon(step) : '📍';
    if (textEl) textEl.textContent = step?.text ?? 'Siga em frente';
    if (distanceEl) distanceEl.textContent = step
      ? formatStepDistance(step.distanceMeters)
      : '';
  }

  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="nhud-bar">
        <div class="nhud-left">
          <div class="nhud-maneuver-icon" id="nhud-icon">📍</div>
        </div>
        <div class="nhud-center">
          <div class="nhud-step-text" id="nhud-text">Siga em frente</div>
          <div class="nhud-step-distance" id="nhud-distance"></div>
        </div>
        <div class="nhud-right">
          <button type="button" class="nhud-close-btn" id="nhud-close" title="Fechar navegação">
            ✕
          </button>
        </div>
      </div>
    `;

    this.container.querySelector('#nhud-close')?.addEventListener('click', () => {
      this.callbacks.onStopNavigation();
    });
  }
}
