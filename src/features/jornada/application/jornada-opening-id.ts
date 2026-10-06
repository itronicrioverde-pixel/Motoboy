import type { NewJornada } from '../domain/jornada';

/** Codificação reversível, sem WebCrypto (também funciona no HTTP da rede local). */
export function jornadaOpeningId(data: NewJornada): string {
  const bytes = new TextEncoder().encode(JSON.stringify([
    data.kmInicial, data.dataInicioISO, data.horaInicioISO,
  ]));
  const id = `j1_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  if (id.length > 1000) throw new Error('Dados de abertura da jornada excedem o limite permitido.');
  return id;
}
