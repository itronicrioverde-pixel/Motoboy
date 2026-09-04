/**
 * API pública do domínio IncomeEntry. Sem default export; sem helpers internos.
 */

export type {
  IncomeEntry,
  IncomeDirection,
  IncomeSourceType,
  IncomeErrorCode,
  IncomeValidation,
  IncomeRepository,
} from './income-entry';
export { validateIncomeEntry } from './income-entry';
