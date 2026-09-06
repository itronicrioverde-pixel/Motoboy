/**
 * Barrel dos adapters Admin/Firestore (DEC-019.3A). Exporta paths, mapeadores e
 * os três adapters; NÃO exporta fakes. Sem default export; sem ciclos.
 */

export { pricingPaths, versionIdOf, activationDocId } from './paths';
export {
  areaToDoc,
  areaPlanToDoc,
  areaFromDoc,
  activeConfigFromDoc,
  activationToDoc,
  activationFromDoc,
  versionMetaToDoc,
  type ActiveConfigData,
  type ActivationData,
} from './mappers';
export { PricingIdGeneratorAdmin } from './id-generator-admin';
export { PricingActiveTableReaderAdmin } from './active-table-reader-admin';
export { PricingPublishTransactionAdmin } from './publish-transaction-admin';
