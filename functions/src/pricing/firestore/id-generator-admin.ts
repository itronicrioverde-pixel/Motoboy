/**
 * Gerador de IDs de área DETERMINÍSTICO (DEC-019.3A). Mesma semente → mesmo id,
 * para que retries (mesma entrada) nunca gerem ids diferentes nem dupliquem
 * áreas. Usa `node:crypto` (server), não aleatoriedade. Id é seguro para
 * Firestore (hex, sem `/`).
 */

import { createHash } from 'node:crypto';
import type { PricingIdGenerator } from '../ports';

export class PricingIdGeneratorAdmin implements PricingIdGenerator {
  newAreaId(seed: string): string {
    const digest = createHash('sha256').update(seed, 'utf8').digest('hex');
    return 'area_' + digest.slice(0, 32);
  }
}
