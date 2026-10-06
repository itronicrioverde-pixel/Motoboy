import { describe, expect, it } from 'vitest';
import { shouldUseLocalEmulators } from './local-emulators';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('modo local dos Firebase Emulators', () => {
  it('não conecta sem flag explícita', () => {
    expect(shouldUseLocalEmulators(false, true, 'demo-motoboy')).toBe(false);
  });

  it('aceita somente desenvolvimento com projeto demo', () => {
    expect(shouldUseLocalEmulators(true, true, 'demo-motoboy')).toBe(true);
    expect(() => shouldUseLocalEmulators(true, false, 'demo-motoboy')).toThrow('modo de desenvolvimento');
    expect(() => shouldUseLocalEmulators(true, true, 'projeto-real')).toThrow('projectId demo-');
    expect(() => shouldUseLocalEmulators(true, true, undefined)).toThrow('projectId demo-');
  });

  it('proxy de desenvolvimento inclui o REST transacional e o canal do Firestore', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8');
    expect(config).toContain("'/google.firestore.v1.Firestore'");
    expect(config).toContain("'/v1/projects/'");
    expect(config).toContain("target: 'http://127.0.0.1:8080'");
  });
});
