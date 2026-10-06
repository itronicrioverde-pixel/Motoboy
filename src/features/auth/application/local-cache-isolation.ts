export interface LocalCacheStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalCacheIsolationResult {
  readonly reload: boolean;
  readonly ignoreLocalCache: boolean;
}

/**
 * Isola o cache legado por UID. Se o storage falhar, o painel pode continuar
 * com os dados remotos, mas nunca deve ler nem sobrescrever o cache incerto.
 */
export function isolateLocalCache(
  uid: string,
  store: LocalCacheStore,
  ownerKey: string,
  panelStateKeys: readonly string[],
): LocalCacheIsolationResult {
  let previousOwner: string | null;
  try {
    previousOwner = store.getItem(ownerKey);
  } catch {
    return { reload: false, ignoreLocalCache: true };
  }

  if (previousOwner === uid) return { reload: false, ignoreLocalCache: false };

  try {
    if (previousOwner !== null) {
      for (const key of panelStateKeys) store.removeItem(key);
      store.setItem(ownerKey, uid);
      return { reload: true, ignoreLocalCache: false };
    }
    // Compatibilidade com o primeiro dono da versão legada.
    store.setItem(ownerKey, uid);
    return { reload: false, ignoreLocalCache: false };
  } catch {
    return { reload: false, ignoreLocalCache: true };
  }
}
