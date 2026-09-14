/**
 * Composition root da feature Moto.
 */

import { currentUid } from '../auth/application/auth-service';
import { MotoService } from './application/moto-service';
import { FirestoreMotoRepository } from './infrastructure/firestore-moto-repository';

const repository = new FirestoreMotoRepository(() => currentUid());
export const motoService = new MotoService(repository);

export type { MotoData } from './domain/moto-data';
