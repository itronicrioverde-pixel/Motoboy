export type ManualConsumptionSaveState = 'loading' | 'pending' | 'awaiting' | 'saved';

export function manualConsumptionStatusText(
  consumption: number,
  state: ManualConsumptionSaveState,
): string {
  const value = `${consumption.toFixed(1).replace('.', ',')} km/L`;
  if (state === 'saved') return `${value} salvos à mão para estimar jornadas.`;
  if (state === 'pending') return `${value}: Sincronizando com sua conta.`;
  if (state === 'awaiting') return `${value}: Aguardando conexão. Ainda não confirmado.`;
  return `${value}: Verificando sincronização com sua conta.`;
}
