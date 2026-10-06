import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { panelUidChanged } from './panel-uid-guard';

describe('panelUidChanged', () => {
  it('não reinicia a primeira entrada nem callbacks do mesmo usuário', () => {
    expect(panelUidChanged(null, 'uid-a')).toBe(false);
    expect(panelUidChanged('uid-a', 'uid-a')).toBe(false);
  });

  it('detecta a troca de usuário sem depender de localStorage', () => {
    expect(panelUidChanged('uid-a', 'uid-b')).toBe(true);
  });

  it('o bootstrap verifica a troca antes do retorno para painel já iniciado', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const entry = main.slice(main.indexOf('function enterAuthenticatedApp('));
    const guard = entry.indexOf('panelUidChanged(activePanelUid, user.uid)');
    const earlyReturn = entry.indexOf('if (panelStarted)');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(earlyReturn).toBeGreaterThan(guard);
    expect(entry).toContain('activePanelUid = user.uid');
  });
});
