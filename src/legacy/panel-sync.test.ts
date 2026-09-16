import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Testes de verificação estática do painel legado (panel.js).
 *
 * O monólito não pode ser unit-tested diretamente (efeitos colaterais, DOM).
 * Estes testes verificam propriedades do código-fonte que garantem:
 * - Ausência de variáveis obsoletas
 * - Hidratação sem sincronização remota
 * - Sincronização bloqueada antes da hidratação
 * - Sincronização somente após mutação real
 */

const PANEL_PATH = resolve(__dirname, './panel.js');
const panelSource = readFileSync(PANEL_PATH, 'utf-8');

describe('panel.js — propriedades estáticas', () => {
  describe('ausência de motoRemoteLoaded', () => {
    it('variável motoRemoteLoaded não existe no código', () => {
      // Verifica declaração: let/const/var motoRemoteLoaded
      const decl = /\b(?:let|const|var)\s+motoRemoteLoaded\b/.test(panelSource);
      expect(decl).toBe(false);
    });

    it('nenhuma referência a motoRemoteLoaded no código', () => {
      const refs = panelSource.match(/\bmotoRemoteLoaded\b/g);
      expect(refs).toBeNull();
    });
  });

  describe('hidratação não chama sincronização remota', () => {
    it('hydrateMoto não contém syncMotoToFirestore', () => {
      const hydrateMotoBlock = extractFunction(panelSource, 'hydrateMoto');
      expect(hydrateMotoBlock).not.toContain('syncMotoToFirestore');
    });

    it('hydrateMoto não contém saveMotoToFirestore', () => {
      const hydrateMotoBlock = extractFunction(panelSource, 'hydrateMoto');
      expect(hydrateMotoBlock).not.toContain('saveMotoToFirestore');
    });

    it('hydrateClientes não contém syncClientsToFirestore', () => {
      const hydrateClientesBlock = extractFunction(panelSource, 'hydrateClientes');
      expect(hydrateClientesBlock).not.toContain('syncClientsToFirestore');
    });

    it('hydrateClientes não contém saveClientsToFirestore', () => {
      const hydrateClientesBlock = extractFunction(panelSource, 'hydrateClientes');
      expect(hydrateClientesBlock).not.toContain('saveClientsToFirestore');
    });

    it('hydrateMoto contém saveLocalState (cache local permitido)', () => {
      const hydrateMotoBlock = extractFunction(panelSource, 'hydrateMoto');
      expect(hydrateMotoBlock).toContain('saveLocalState');
    });

    it('hydrateClientes contém saveLocalState (cache local permitido)', () => {
      const hydrateClientesBlock = extractFunction(panelSource, 'hydrateClientes');
      expect(hydrateClientesBlock).toContain('saveLocalState');
    });
  });

  describe('__applyRemoteMoto não habilita persistência', () => {
    it('__applyRemoteMoto não contém motoHydrated', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteMoto');
      expect(block).not.toMatch(/motoHydrated\s*=\s*true/);
    });

    it('__applyRemoteMoto não contém syncMotoToFirestore', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteMoto');
      expect(block).not.toContain('syncMotoToFirestore');
    });

    it('__applyRemoteMoto não contém saveLocalState', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteMoto');
      expect(block).not.toContain('saveLocalState');
    });
  });

  describe('__applyRemoteClientes não habilita persistência', () => {
    it('__applyRemoteClientes não contém clientsHydrated', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteClientes');
      expect(block).not.toMatch(/clientsHydrated\s*=\s*true/);
    });

    it('__applyRemoteClientes não contém syncClientsToFirestore', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteClientes');
      expect(block).not.toContain('syncClientsToFirestore');
    });
  });

  describe('sync bloqueado antes da hidratação', () => {
    it('syncMotoToFirestore tem guarda if(!motoHydrated) return', () => {
      const block = extractFunction(panelSource, 'syncMotoToFirestore');
      expect(block).toMatch(/if\s*\(\s*!motoHydrated\s*\)\s*return/);
    });

    it('syncClientsToFirestore tem guarda if(!clientsHydrated) return', () => {
      const block = extractFunction(panelSource, 'syncClientsToFirestore');
      expect(block).toMatch(/if\s*\(\s*!clientsHydrated\s*\)\s*return/);
    });

    it('saveMotoToFirestore tem guarda if(!motoHydrated) return', () => {
      const block = extractFunction(panelSource, 'saveMotoToFirestore');
      expect(block).toMatch(/if\s*\(\s*!motoHydrated\s*\)\s*return/);
    });
  });

  describe('confirmação de rota — sem sync de moto', () => {
    it('fluxo de confirmação não chama syncMotoToFirestore', () => {
      // O bloco de confirmação começa com "confirmedRoutes.unshift(novaRota)"
      // e vai até "const confirmationMessage"
      const confirmStart = panelSource.indexOf('confirmedRoutes.unshift(novaRota)');
      const confirmEnd = panelSource.indexOf('const confirmationMessage', confirmStart);
      expect(confirmStart).toBeGreaterThan(-1);
      expect(confirmEnd).toBeGreaterThan(confirmStart);
      const confirmBlock = panelSource.slice(confirmStart, confirmEnd);
      expect(confirmBlock).not.toContain('syncMotoToFirestore');
    });

    it('confirmação sincroniza clientes somente com pendenteTotal > 0', () => {
      const confirmStart = panelSource.indexOf('confirmedRoutes.unshift(novaRota)');
      const confirmEnd = panelSource.indexOf('const confirmationMessage', confirmStart);
      const confirmBlock = panelSource.slice(confirmStart, confirmEnd);
      // Deve ter a condição if(pendenteTotal > 0) antes de syncClientsToFirestore
      expect(confirmBlock).toMatch(/if\s*\(\s*pendenteTotal\s*>\s*0\s*\)/);
      expect(confirmBlock).toContain('syncClientsToFirestore');
    });
  });

  describe('rota de cancelamento — sync de clientes condicional', () => {
    it('cancelConfirmedRoute usa flag clientsChanged para decidir sync', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('clientsChanged');
      expect(body).toMatch(/if\s*\(\s*clientsChanged\s*\)\s*syncClientsToFirestore/);
    });

    it('recalcula saldo somente dos clientes cujas contas foram removidas', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('c.contas.length !== before');
      expect(body).toMatch(/syncClientBalance\(c\)/);
    });

    it('nenhuma conta corresponde ao routeId: não altera clientes e não sincroniza', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      // Se nenhum filter removeu contas, before === c.contas.length → clientsChanged = false
      // O bloco só marca clientsChanged = true quando lengths divergem
      expect(body).toMatch(/const before\s*=\s*c\.contas\.length/);
      expect(body).toMatch(/if\s*\(\s*c\.contas\.length\s*!==\s*before\s*\)/);
      // syncClientsToFirestore nunca é chamado incondicionalmente
      expect(body).not.toMatch(/saveLocalState\(\);\s*syncClientsToFirestore\(\)/);
    });

    it('existe correspondência: remove contas da rota, preserva demais e sincroniza uma vez', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      // O filter preserva contas que NÃO têm o routeId cancelado
      expect(body).toMatch(/c\.contas\s*=\s*c\.contas\.filter\(\s*conta\s*=>\s*conta\.routeId\s*!==\s*routeId\s*\)/);
      // Sync acontece exatamente uma vez (só na condição)
      const syncCalls = body.match(/syncClientsToFirestore/g) || [];
      expect(syncCalls).toHaveLength(1);
    });
  });
});

// ---------- Helpers ----------

/**
 * Extrai o bloco de uma função declarada com function name() { ... }
 * Retorna o conteúdo entre as chaves (nível 0).
 */
function extractFunction(source: string, name: string): string {
  const regex = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = regex.exec(source);
  if (!match) return '';
  const startIdx = source.indexOf('{', match.index);
  return extractBracedBlock(source, startIdx);
}

/**
 * Extrai o bloco atribuído a window.__applyRemoteXxx = function(data){ ... }
 */
function extractWindowAssignment(source: string, propName: string): string {
  const regex = new RegExp(`window\\.__${propName}\\s*=\\s*function`);
  const match = regex.exec(source);
  if (!match) return '';
  const startIdx = source.indexOf('{', match.index);
  return extractBracedBlock(source, startIdx);
}

/**
 * Extrai o conteúdo entre chaves no nível 0 a partir de uma posição.
 */
function extractBracedBlock(source: string, startIdx: number): string {
  if (startIdx < 0) return '';
  let depth = 0;
  let i = startIdx;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
    i++;
  }
  return source.slice(startIdx, startIdx + 2000);
}
