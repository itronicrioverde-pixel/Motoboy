/**
 * Composition root da feature Pricing (Tabela de deslocamento — DEC-020).
 * Monta o repositório de leitura com Firestore, escopado pelo uid atual.
 * O gateway de publicação é um stub até o callable do servidor estar pronto.
 */

import { currentUid } from '../auth/application/auth-service';
import { FirestorePricingReadRepository } from './infrastructure/firestore-pricing-read-repository';
import { FirestorePricingPublishGateway } from './infrastructure/firestore-pricing-publish-gateway';

export const pricingReadRepository = new FirestorePricingReadRepository(() => currentUid());
export const pricingPublishGateway = new FirestorePricingPublishGateway();

export type {
  ActivePricingTableSnapshot,
  PricingTableReadResult,
  PricingTableReadRepository,
} from './application/ports/pricing-table-read-repository';

export type {
  PricingPublishGateway,
  PublishPricingRequest,
  PublishGatewayResult,
} from './application/ports/pricing-publish-gateway';

export { analyzePricingImport, publishResolvedPricingTable } from './application';
