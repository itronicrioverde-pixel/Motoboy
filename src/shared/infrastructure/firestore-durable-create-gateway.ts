/** Cria uma vez por ID, com marcador transacional para retry após resposta perdida. */
import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import {
  isDurableCreateAttempt,
  type DurableCreateAttempt,
  type DurableCreateGateway,
  type DurableCreateResult,
} from '../application/durable-create-manager';

export class FirestoreDurableCreateGateway implements DurableCreateGateway {
  constructor(
    private readonly db: Firestore,
    private readonly currentUid: () => string | null,
  ) {}

  async commit(attempt: DurableCreateAttempt): Promise<DurableCreateResult> {
    if (!isDurableCreateAttempt(attempt)) throw new Error('Tentativa de criação inválida.');
    if (this.currentUid() !== attempt.uid) throw new Error('Tentativa pertence a outro usuário.');

    const target = doc(this.db, 'users', attempt.uid, attempt.kind, attempt.id);
    const marker = doc(this.db, 'users', attempt.uid, 'createAttempts', `${attempt.kind}_${attempt.id}`);
    const payloadJson = JSON.stringify(attempt.payload);
    // Tudo que depende de hora/aleatoriedade já foi preparado e persistido.
    return runTransaction(this.db, async (tx) => {
      const markerSnapshot = await tx.get(marker);
      const targetSnapshot = await tx.get(target);
      if (markerSnapshot.exists()) {
        if (markerSnapshot.data().payloadJson !== payloadJson) {
          throw new Error('Tentativa já aplicada com payload diferente.');
        }
        // Se outro aparelho apagou o registro após o commit, nunca o ressuscitar.
        return targetSnapshot.exists() ? 'already-applied' : 'removed';
      }
      if (targetSnapshot.exists()) {
        // Documento legado/colisão: não sobrescrever nem reivindicar como nosso.
        throw new Error('ID remoto já pertence a outro registro.');
      }
      tx.set(target, attempt.payload);
      tx.set(marker, {
        uid: attempt.uid,
        kind: attempt.kind,
        id: attempt.id,
        payloadJson,
        createdAt: attempt.payload.createdAt,
      });
      return 'created';
    });
  }
}
