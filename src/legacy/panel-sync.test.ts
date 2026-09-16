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
 * - Uso do SyncGate real para controle de escrita
 */

const PANEL_PATH = resolve(__dirname, './panel.js');
const panelSource = readFileSync(PANEL_PATH, 'utf-8');

describe('panel.js — propriedades estáticas', () => {
  describe('ausência de motoRemoteLoaded', () => {
    it('variável motoRemoteLoaded não existe no código', () => {
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
    it('__applyRemoteMoto não contém motoHydrated.open', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteMoto');
      expect(block).not.toMatch(/motoHydrated\.open\s*\(/);
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
    it('__applyRemoteClientes não contém clientsHydrated.open', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteClientes');
      expect(block).not.toMatch(/clientsHydrated\.open\s*\(/);
    });

    it('__applyRemoteClientes não contém syncClientsToFirestore', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteClientes');
      expect(block).not.toContain('syncClientsToFirestore');
    });
  });

  describe('sync bloqueado antes da hidratação via SyncGate', () => {
    it('syncMotoToFirestore tem guarda if(!motoHydrated.isOpen) return', () => {
      const block = extractFunction(panelSource, 'syncMotoToFirestore');
      expect(block).toMatch(/if\s*\(\s*!motoHydrated\.isOpen\s*\)\s*return/);
    });

    it('syncClientsToFirestore tem guarda if(!clientsHydrated.isOpen) return', () => {
      const block = extractFunction(panelSource, 'syncClientsToFirestore');
      expect(block).toMatch(/if\s*\(\s*!clientsHydrated\.isOpen\s*\)\s*return/);
    });

    it('saveMotoToFirestore tem guarda if(!motoHydrated.isOpen) return', () => {
      const block = extractFunction(panelSource, 'saveMotoToFirestore');
      expect(block).toMatch(/if\s*\(\s*!motoHydrated\.isOpen\s*\)\s*return/);
    });

    it('saveClientsToFirestore tem guarda if(!clientsRemoteRead.isOpen) return', () => {
      const block = extractFunction(panelSource, 'saveClientsToFirestore');
      expect(block).toMatch(/if\s*\(\s*!clientsRemoteRead\.isOpen\s*\)\s*return/);
    });
  });

  describe('confirmação de rota — sem sync de moto', () => {
    it('fluxo de confirmação não chama syncMotoToFirestore', () => {
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
      expect(body).toMatch(/const before\s*=\s*c\.contas\.length/);
      expect(body).toMatch(/if\s*\(\s*c\.contas\.length\s*!==\s*before\s*\)/);
      expect(body).not.toMatch(/saveLocalState\(\);\s*syncClientsToFirestore\(\)/);
    });

    it('existe correspondência: remove contas da rota, preserva demais e sincroniza uma vez', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toMatch(/c\.contas\s*=\s*c\.contas\.filter\(\s*conta\s*=>\s*conta\.routeId\s*!==\s*routeId\s*\)/);
      const syncCalls = body.match(/syncClientsToFirestore/g) || [];
      expect(syncCalls).toHaveLength(1);
    });
  });

  describe('dual source — SyncGate import e uso', () => {
    it('panel.js importa SyncGate', () => {
      expect(panelSource).toContain("import { SyncGate } from");
    });

    it('clientsRemoteRead é instância de SyncGate', () => {
      const decl = panelSource.match(/const\s+clientsRemoteRead\s*=\s*new\s+SyncGate\s*\(/);
      expect(decl).not.toBeNull();
    });

    it('motoHydrated é instância de SyncGate', () => {
      const decl = panelSource.match(/const\s+motoHydrated\s*=\s*new\s+SyncGate\s*\(/);
      expect(decl).not.toBeNull();
    });

    it('clientsHydrated é instância de SyncGate', () => {
      const decl = panelSource.match(/const\s+clientsHydrated\s*=\s*new\s+SyncGate\s*\(/);
      expect(decl).not.toBeNull();
    });

    it('hydrateClientes abre clientsRemoteRead e clientsHydrated', () => {
      const block = extractFunction(panelSource, 'hydrateClientes');
      expect(block).toContain('clientsRemoteRead.open()');
      expect(block).toContain('clientsHydrated.open()');
    });

    it('hydrateClientes abre clientsRemoteRead antes de clientsHydrated', () => {
      const block = extractFunction(panelSource, 'hydrateClientes');
      const readIdx = block.indexOf('clientsRemoteRead.open()');
      const hydratedIdx = block.indexOf('clientsHydrated.open()');
      expect(readIdx).toBeGreaterThan(-1);
      expect(hydratedIdx).toBeGreaterThan(readIdx);
    });

    it('hydrateMoto abre motoHydrated', () => {
      const block = extractFunction(panelSource, 'hydrateMoto');
      expect(block).toContain('motoHydrated.open()');
    });

    it('__applyRemoteClientes NÃO abre gates', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteClientes');
      expect(block).not.toMatch(/\.(open|close)\s*\(/);
    });
  });

  describe('dual source — merge por ID estável', () => {
    it('hydrateClientes chama mergeLegacyCustomers', () => {
      const block = extractFunction(panelSource, 'hydrateClientes');
      expect(block).toContain('mergeLegacyCustomers');
    });

    it('panel.js importa mergeLegacyCustomers', () => {
      expect(panelSource).toContain("import { mergeLegacyCustomers } from");
    });
  });
});

// ---------- Helpers ----------

function extractFunction(source: string, name: string): string {
  const regex = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = regex.exec(source);
  if (!match) return '';
  const startIdx = source.indexOf('{', match.index);
  return extractBracedBlock(source, startIdx);
}

function extractWindowAssignment(source: string, propName: string): string {
  const regex = new RegExp(`window\\.__${propName}\\s*=\\s*function`);
  const match = regex.exec(source);
  if (!match) return '';
  const startIdx = source.indexOf('{', match.index);
  return extractBracedBlock(source, startIdx);
}

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
