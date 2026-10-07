import { describe, expect, it } from 'vitest';
import { manualConsumptionStatusText } from './manual-consumption-status';

describe('confirmação visual do consumo manual', () => {
  it('não anuncia salvo antes da confirmação do servidor', () => {
    expect(manualConsumptionStatusText(38, 'pending')).toContain('Sincronizando');
    expect(manualConsumptionStatusText(38, 'awaiting')).toContain('Aguardando conexão');
    expect(manualConsumptionStatusText(38, 'pending')).not.toContain('salvos');
    expect(manualConsumptionStatusText(38, 'awaiting')).not.toContain('salvos');
  });

  it('anuncia salvo somente no estado confirmado', () => {
    expect(manualConsumptionStatusText(38, 'saved'))
      .toBe('38,0 km/L salvos à mão para estimar jornadas.');
  });
});
