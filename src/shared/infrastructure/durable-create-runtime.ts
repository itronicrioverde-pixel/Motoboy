/** Composition root das criações duráveis dos três fluxos financeiros do beta. */
import { db } from '../../config/firebase.js';
import { currentUid } from '../../features/auth/application/auth-service';
import { createDurableCreateManager } from '../application/durable-create-manager';
import { FirestoreDurableCreateGateway } from './firestore-durable-create-gateway';
import { createLocalStorageDurableCreateStore } from './local-storage-durable-create-store';
import { generateUuid } from './random-id';

export const durableCreateManager = createDurableCreateManager({
  currentUid,
  generateId: generateUuid,
  now: () => Date.now(),
  store: createLocalStorageDurableCreateStore(),
  gateway: new FirestoreDurableCreateGateway(db, currentUid),
});
