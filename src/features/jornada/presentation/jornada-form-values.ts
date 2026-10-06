/** Valores digitados na jornada: null significa vazio, NaN significa inválido. */
export function parseJornadaFormValue(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value);
  const simple = /^\d+(?:[.,]\d+)?$/.test(value);
  if (!grouped && !simple) return NaN;
  const normalized = grouped ? value.replace(/\./g, '').replace(',', '.') : value.replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}