import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isolateLocalCache } from './local-cache-isolation';

const ownerKey = 'owner';
const panelKeys = ['panel'];

function store(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('isolateLocalCache', () => {
  it('mantém o cache do mesmo UID', () => {
    const storage = store({ owner: 'uid-a', panel: 'a-data' });
    expect(isolateLocalCache('uid-a', storage, ownerKey, panelKeys)).toEqual({
      reload: false, ignoreLocalCache: false,
    });
    expect(storage.data.get('panel')).toBe('a-data');
  });

  it('limpa o cache de outro UID e exige recarga', () => {
    const storage = store({ owner: 'uid-a', panel: 'a-data' });
    expect(isolateLocalCache('uid-b', storage, ownerKey, panelKeys)).toEqual({
      reload: true, ignoreLocalCache: false,
    });
    expect(storage.data.has('panel')).toBe(false);
    expect(storage.data.get('owner')).toBe('uid-b');
  });

  it('falha fechada quando não consegue ler o dono do cache', () => {
    const storage = store({ panel: 'a-data' });
    storage.getItem = () => { throw new Error('storage blocked'); };
    expect(isolateLocalCache('uid-b', storage, ownerKey, panelKeys)).toEqual({
      reload: false, ignoreLocalCache: true,
    });
  });

  it('falha fechada quando não consegue remover o cache de outro UID', () => {
    const storage = store({ owner: 'uid-a', panel: 'a-data' });
    storage.removeItem = () => { throw new Error('storage blocked'); };
    expect(isolateLocalCache('uid-b', storage, ownerKey, panelKeys)).toEqual({
      reload: false, ignoreLocalCache: true,
    });
    expect(storage.data.get('panel')).toBe('a-data');
  });

  it('não adota cache legado se não consegue gravar a marca do primeiro dono', () => {
    const storage = store({ panel: 'unknown-data' });
    storage.setItem = () => { throw new Error('storage blocked'); };
    expect(isolateLocalCache('uid-b', storage, ownerKey, panelKeys)).toEqual({
      reload: false, ignoreLocalCache: true,
    });
  });

  it('o painel não lê nem sobrescreve localStorage quando o cache é incerto', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/legacy/panel.js'), 'utf8');
    const read = source.slice(source.indexOf('function readLocalState(){'));
    const save = source.slice(source.indexOf('function saveLocalState(){'));
    expect(read.indexOf('if(ignoreLocalCache) return {}')).toBeLessThan(read.indexOf('localStorage.getItem'));
    expect(save.indexOf('if(ignoreLocalCache)')).toBeLessThan(save.indexOf('localStorage.setItem'));
  });
});
