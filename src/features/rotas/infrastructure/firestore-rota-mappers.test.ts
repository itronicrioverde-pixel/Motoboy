import { describe, expect, it } from 'vitest';
import { toRotaService } from './firestore-rota-mappers';

describe('toRotaService', () => {
  it('preserva serviceId do snapshot Firestore usado no retry após reload', () => {
    const service = toRotaService({
      serviceId: 'svc-persisted',
      coleta: 'Loja A',
      cliente: 'Cliente A',
      paymentStatus: 'pending',
      valorTotal: 25,
      entregas: [{
        endereco: 'Rua B',
        valor: 25,
        distancia: 4,
        tempo: 12,
        aproximada: false,
      }],
    });

    expect(service.serviceId).toBe('svc-persisted');
    expect(service.entregas).toEqual([{
      endereco: 'Rua B',
      valor: 25,
      distancia: 4,
      tempo: 12,
      aproximada: false,
    }]);
  });

  it('mantém compatibilidade com rota histórica sem serviceId', () => {
    const service = toRotaService({
      coleta: 'Loja antiga',
      cliente: '',
      paymentStatus: 'received',
      valorTotal: 10,
      entregas: [],
    });

    expect(service).not.toHaveProperty('serviceId');
  });
});
