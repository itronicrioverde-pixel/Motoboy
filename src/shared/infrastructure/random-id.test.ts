import { describe, expect, it, vi } from 'vitest';
import { generateUuid } from './random-id';

describe('generateUuid', () => {
  it('usa randomUUID quando o navegador oferece a API', () => {
    const randomUUID = vi.fn(() => 'native-id');
    const getRandomValues = vi.fn();
    expect(generateUuid({ randomUUID, getRandomValues })).toBe('native-id');
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('gera UUID v4 com getRandomValues em contexto HTTP sem randomUUID', () => {
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      bytes.forEach((_, index) => { bytes[index] = index; });
      return array;
    };
    expect(generateUuid({ getRandomValues })).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('mantém UUID único compatível quando Web Crypto não existe no HTTP LAN', () => {
    expect(generateUuid(null, () => 0, () => 0x010203040506))
      .toBe('00000000-0000-4000-8000-010203040506');
  });
});
