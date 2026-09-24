/**
 * Composition root da feature Jornada.
 */

import { currentUid } from '../auth/application/auth-service';
import { JornadaService } from './application/jornada-service';
import { FirestoreJornadaRepository } from './infrastructure/firestore-jornada-repository';

const repository = new FirestoreJornadaRepository(() => currentUid());

export const jornadaService = new JornadaService(repository);

export { JornadaService, JornadaValidationError } from './application/jornada-service';
export type {
  Jornada,
  NewJornada,
  CloseJornada,
  ConsumoOrigem,
  PrecoOrigem,
} from './domain/jornada';