/**
 * Barrel do slice server-side de pricing (DEC-019.2). Exporta contratos e o
 * caso de uso; NÃO exporta os fakes de teste. Sem default export; sem ciclos.
 */

export type {
  ServerActiveTableSnapshot,
  ActiveTableReadResult,
  PricingActiveTableReader,
  PricingIdGenerator,
  RequestHasher,
  PublishAreaPlan,
  PublishPlan,
  CommitPublishRequest,
  CommitPublishResult,
  PricingPublishTransaction,
} from './ports';

export { Sha256RequestHasher } from './sha256-request-hasher';

export type {
  PublishPricingTableInput,
  PublishPricingTableDeps,
  PublishPricingTableResult,
} from './publish-pricing-table';
export { publishPricingTable } from './publish-pricing-table';

// Adapters Admin/Firestore (DEC-019.3A) — implementações das ports.
export * from './firestore';
