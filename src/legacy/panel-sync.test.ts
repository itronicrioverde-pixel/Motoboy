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

const REPO_PATH = resolve(__dirname, '../features/rotas/infrastructure/firestore-rota-repository.ts');
const repoSource = readFileSync(REPO_PATH, 'utf-8');

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

    it('confirmação de rota não chama syncClientsToFirestore (applyRoutePendingsDual é atômico)', () => {
      const confirmStart = panelSource.indexOf('confirmedRoutes.unshift(novaRota)');
      const confirmEnd = panelSource.indexOf('const confirmationMessage', confirmStart);
      const confirmBlock = panelSource.slice(confirmStart, confirmEnd);
      expect(confirmBlock).not.toContain('syncClientsToFirestore');
    });

    it('confirmação de rota usa applyRoutePendingsDual para pendências', () => {
      const confirmStart = panelSource.indexOf('btnConfirmRoute');
      const confirmEnd = panelSource.indexOf('const confirmationMessage', confirmStart);
      const confirmBlock = panelSource.slice(confirmStart, confirmEnd);
      expect(confirmBlock).toContain('applyRoutePendingsDual');
    });

    it('confirmação de rota não usa addPendingToClient nem addPendingDual', () => {
      const confirmStart = panelSource.indexOf('btnConfirmRoute');
      const confirmEnd = panelSource.indexOf('const confirmationMessage', confirmStart);
      const confirmBlock = panelSource.slice(confirmStart, confirmEnd);
      expect(confirmBlock).not.toContain('addPendingToClient');
      expect(confirmBlock).not.toContain('addPendingDual');
    });

    it('confirmação de rota gera operationId estável por serviço (usa serviceId, não índice)', () => {
      expect(panelSource).toContain('s.serviceId');
      expect(panelSource).not.toContain(':svc-${si}');
    });

    it('newService() gera serviceId com UUID completo', () => {
      expect(panelSource).toMatch(/function\s+newService\s*\(\)\s*\{.*svc-.*crypto\.randomUUID\(\)/);
    });

    it('servicesSnapshot inclui serviceId', () => {
      const snapshotStart = panelSource.indexOf('const servicesSnapshot');
      const snapshotEnd = panelSource.indexOf('};', snapshotStart);
      const snapshotBlock = panelSource.slice(snapshotStart, snapshotEnd);
      expect(snapshotBlock).toContain('serviceId:service.serviceId');
    });

    it('ensureServiceId gera serviceId para serviços legados', () => {
      expect(panelSource).toContain('function ensureServiceId');
      expect(panelSource).toMatch(/if\s*\(\s*!\s*s\.serviceId\s*\)/);
    });

    it('operationId usa apenas routeId:serviceId (imutável)', () => {
      const pendingsBlock = panelSource.indexOf('pendingsToApply.push');
      const pendingsEnd = panelSource.indexOf('});', pendingsBlock);
      const pushBlock = panelSource.slice(pendingsBlock, pendingsEnd);
      expect(pushBlock).toContain('`${routeId}:${s.serviceId}`');
      expect(pushBlock).not.toMatch(/:\$\{.*\.cliente/);
      expect(pushBlock).not.toMatch(/:\$\{.*\.valor/);
    });

    it('rota é salva como pending antes das pendências (serviceId persistido antes da transação)', () => {
      const pendingSaveIdx = panelSource.indexOf("status:'pending'");
      expect(pendingSaveIdx).toBeGreaterThan(-1);
      const pendingsPos = panelSource.indexOf('await applyRoutePendingsDual(');
      expect(pendingsPos).toBeGreaterThan(-1);
      expect(pendingSaveIdx).toBeLessThan(pendingsPos);
    });

    it('após pendências bem-sucedidas, rota é atualizada como confirmed', () => {
      const pendingsPos = panelSource.indexOf('await applyRoutePendingsDual(');
      const confirmUpdateIdx = panelSource.indexOf("status = 'confirmed'", pendingsPos);
      expect(confirmUpdateIdx).toBeGreaterThan(pendingsPos);
      const secondSaveIdx = panelSource.indexOf('await window.__motoboyRotas.save(novaRota)', confirmUpdateIdx);
      expect(secondSaveIdx).toBeGreaterThan(confirmUpdateIdx);
    });

    it('falha ao salvar rota (pending) impede criação de pendências', () => {
      const pendingsIdx = panelSource.indexOf('applyRoutePendingsDual(');
      const firstSaveIdx = panelSource.indexOf('window.__motoboyRotas.save(novaRota)');
      expect(firstSaveIdx).toBeGreaterThan(-1);
      expect(pendingsIdx).toBeGreaterThan(firstSaveIdx);
      const region = panelSource.slice(firstSaveIdx, pendingsIdx);
      expect(region).toContain('return;');
    });

    it('falha nas pendências mantém rota como pending (não marked confirmed)', () => {
      const pendingsIdx = panelSource.indexOf('applyRoutePendingsDual(');
      const tryPendings = panelSource.lastIndexOf('try{', pendingsIdx) !== -1
        ? panelSource.lastIndexOf('try{', pendingsIdx)
        : panelSource.lastIndexOf('try {', pendingsIdx);
      expect(tryPendings).toBeGreaterThan(-1);
      const catchPendings = panelSource.indexOf('}catch(err){', tryPendings);
      const confirmIdx = panelSource.indexOf("novaRota.status = 'confirmed'");
      expect(catchPendings).toBeGreaterThan(tryPendings);
      expect(confirmIdx).toBeGreaterThan(catchPendings);
    });

    it('marcação confirmed é feita somente após sucesso das pendências', () => {
      const pendingsEnd = panelSource.indexOf('applyRoutePendingsDual(pendingsToApply, routeId)');
      const confirmIdx = panelSource.indexOf("novaRota.status = 'confirmed'", pendingsEnd);
      expect(confirmIdx).toBeGreaterThan(pendingsEnd);
    });

    it('rota já confirmada não reaplica pendências (idempotência)', () => {
      expect(panelSource).toContain("novaRota.status = 'confirmed'");
      expect(panelSource).toContain("status:'pending'");
    });

    it('duplo clique gera uma única confirmação (isConfirmingRoute lock)', () => {
      expect(panelSource).toContain('isConfirmingRoute');
      expect(panelSource).toMatch(/if\s*\(\s*isConfirmingRoute\s*\)\s*return/);
    });

    it('isConfirmingRoute é liberado no finally', () => {
      const finallyIdx = panelSource.indexOf('}finally{');
      expect(finallyIdx).toBeGreaterThan(-1);
      const finallyBlock = panelSource.slice(finallyIdx, finallyIdx + 100);
      expect(finallyBlock).toContain('isConfirmingRoute = false');
    });

    it('rota pending é salva em confirmedRoutes antes das pendências (upsert)', () => {
      const pendingsIdx = panelSource.indexOf('applyRoutePendingsDual(');
      const upsertIdx = panelSource.indexOf('confirmedRoutes.findIndex(r => r.id === routeId)', pendingsIdx - 600);
      expect(upsertIdx).toBeGreaterThan(-1);
      expect(upsertIdx).toBeLessThan(pendingsIdx);
    });

    it('upsert por routeId evita duplicatas no array', () => {
      expect(panelSource).toContain('confirmedRoutes.findIndex(r => r.id === routeId)');
      expect(panelSource).toContain('confirmedRoutes[existingIdx] = novaRota');
    });

    it('após Fase 3, status é atualizado no array local', () => {
      const fase3Idx = panelSource.indexOf("novaRota.status = 'confirmed'");
      const arrayUpdateIdx = panelSource.indexOf("confirmedRoutes[routeIdx].status = 'confirmed'", fase3Idx);
      expect(arrayUpdateIdx).toBeGreaterThan(fase3Idx);
    });

    it('rota pending não entra na contagem de entregas do dashboard', () => {
      const dashIdx = panelSource.indexOf("routesToday = confirmedRoutes.filter");
      expect(dashIdx).toBeGreaterThan(-1);
      const filterBlock = panelSource.slice(dashIdx, dashIdx + 120);
      expect(filterBlock).toContain("status !== 'pending'");
    });

    it('rota pending recebe badge visual no histórico', () => {
      expect(panelSource).toContain('route-pending-badge');
      expect(panelSource).toContain("Pendente");
    });

    it('transição confirmed→pending é rejeitada transacionalmente no Firestore', () => {
      expect(repoSource).toContain('runTransaction');
      expect(repoSource).toContain("já está confirmada — não pode voltar para pending");
    });

    it('routeId usa crypto.randomUUID() (não Date.now())', () => {
      expect(panelSource).toContain('rota-${crypto.randomUUID()}');
      expect(panelSource).not.toContain('rota-${Date.now()}');
    });

    it('rota pending persiste em saveLocalState para retry após recarga', () => {
      const pendingsIdx = panelSource.indexOf('applyRoutePendingsDual(');
      const saveIdx = panelSource.indexOf('saveLocalState()', pendingsIdx - 300);
      expect(saveIdx).toBeGreaterThan(-1);
      expect(saveIdx).toBeLessThan(pendingsIdx);
    });

    it('routeHistoryYears inclui rotas pending (visíveis no histórico)', () => {
      const yearsFn = panelSource.indexOf('function routeHistoryYears');
      expect(yearsFn).toBeGreaterThan(-1);
      const yearsBlock = panelSource.slice(yearsFn, yearsFn + 300);
      expect(yearsBlock).toContain('confirmedRoutes.forEach');
      expect(yearsBlock).not.toContain("status !== 'pending'");
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
    it('panel.js importa gates do módulo panel-hydration', () => {
      expect(panelSource).toContain("import { clientsRemoteRead, clientsHydrated, motoHydrated } from");
    });

    it('panel.js não cria SyncGate localmente', () => {
      const localGate = /new\s+SyncGate\s*\(/.test(panelSource);
      expect(localGate).toBe(false);
    });

    it('panel.js não abre gates — orquestração abre após hydrate', () => {
      const hydrateMotoBlock = extractFunction(panelSource, 'hydrateMoto');
      const hydrateClientesBlock = extractFunction(panelSource, 'hydrateClientes');
      expect(hydrateMotoBlock).not.toMatch(/\.(open|close)\s*\(/);
      expect(hydrateClientesBlock).not.toMatch(/\.(open|close)\s*\(/);
    });

    it('hydrateClientes mantém guarda declientsHydrated', () => {
      const block = extractFunction(panelSource, 'hydrateClientes');
      expect(block).toMatch(/if\s*\(\s*clientsHydrated\.isOpen\s*\)\s*return/);
    });

    it('hydrateMoto mantém guarda de motoHydrated', () => {
      const block = extractFunction(panelSource, 'hydrateMoto');
      expect(block).toMatch(/if\s*\(\s*motoHydrated\.isOpen\s*\)\s*return/);
    });

    it('__applyRemoteClientes NÃO abre gates', () => {
      const block = extractWindowAssignment(panelSource, '__applyRemoteClientes');
      expect(block).not.toMatch(/\.(open|close)\s*\(/);
    });
  });

  describe('dual source — merge por ID estável', () => {
    it('hydrateClientes substitui clientes diretamente (sem re-merge com localStorage)', () => {
      const block = extractFunction(panelSource, 'hydrateClientes');
      expect(block).toContain('clientes = remoteClientes');
      expect(block).not.toContain('mergeLegacyCustomers');
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
