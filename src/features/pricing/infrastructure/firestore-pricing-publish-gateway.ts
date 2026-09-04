/**
 * Implementação stub do PricingPublishGateway (infraestrutura).
 *
 * A publicação autoritativa é feita pelo callable no servidor (Cloud Functions).
 * Este stub permite que o cliente compile e rode; a implementação real virá
 * quando o callable estiver pronto (DEC-020.3B).
 *
 * Enquanto isso, o gateway rejeita todas as chamadas com OFFLINE.
 */

import type {
  PublishGatewayResult,
  PublishPricingRequest,
  PricingPublishGateway,
} from '../application/ports/pricing-publish-gateway';

export class FirestorePricingPublishGateway implements PricingPublishGateway {
  async _publish(_request: PublishPricingRequest): Promise<PublishGatewayResult> {
    // Stub: a implementação real virá com o callable do servidor.
    return {
      ok: false,
      code: 'OFFLINE',
      message: 'Publicação de tabela de deslocamento ainda não disponível no cliente.',
    };
  }

  /**
   * Alias público: delega ao _publish (stub).
   * Quando o callable estiver pronto, este método será substituído.
   */
  async publish(request: PublishPricingRequest): Promise<PublishGatewayResult> {
    return this._publish(request);
  }
}
