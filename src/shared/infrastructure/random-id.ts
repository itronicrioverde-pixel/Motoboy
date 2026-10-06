interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?<T extends ArrayBufferView>(array: T): T;
}

/**
 * UUID v4 também no HTTP da rede local. `crypto.randomUUID()` exige contexto
 * seguro em alguns navegadores; `getRandomValues()` é a primeira alternativa.
 * Em WebViews que removem Web Crypto por completo, combina tempo e Math.random.
 * Estes IDs garantem unicidade/idempotência e nunca são usados como segredo.
 */
export function generateUuid(
  source: RandomSource | null | undefined = globalThis.crypto,
  fallbackRandom: () => number = Math.random,
  now: () => number = Date.now,
): string {
  if (source && typeof source.randomUUID === 'function') {
    try { return source.randomUUID(); } catch { /* tenta as alternativas */ }
  }
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === 'function') {
    try { source.getRandomValues(bytes); } catch { fillFallback(bytes, fallbackRandom, now()); }
  } else {
    fillFallback(bytes, fallbackRandom, now());
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function fillFallback(bytes: Uint8Array, random: () => number, timestamp: number): void {
  bytes.forEach((_, index) => { bytes[index] = Math.floor(random() * 256) & 0xff; });
  let remaining = Math.max(0, Math.floor(timestamp));
  for (let index = 15; index >= 10; index -= 1) {
    bytes[index] ^= remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
}
