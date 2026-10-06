import { describe, expect, it } from 'vitest';
import { jornadaOpeningId } from './jornada-opening-id';

describe('identidade de abertura da jornada', () => {
  it('é estável entre recargas e não depende de WebCrypto', () => {
    const data = { kmInicial: 1500, dataInicioISO: '2026-10-01', horaInicioISO: '08:00' };
    const id = jornadaOpeningId(data);
    expect(id).toBe(jornadaOpeningId({ ...data }));
    expect(id).toMatch(/^j1_[a-f0-9]+$/);
  });

  it('distingue aberturas com qualquer campo diferente', () => {
    const data = { kmInicial: 1500, dataInicioISO: '2026-10-01', horaInicioISO: '08:00' };
    const id = jornadaOpeningId(data);
    expect(jornadaOpeningId({ ...data, kmInicial: 1501 })).not.toBe(id);
    expect(jornadaOpeningId({ ...data, dataInicioISO: '2026-10-02' })).not.toBe(id);
    expect(jornadaOpeningId({ ...data, horaInicioISO: '08:01' })).not.toBe(id);
  });
});
