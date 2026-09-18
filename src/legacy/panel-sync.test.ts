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

const ORCHESTRATOR_PATH = resolve(
  __dirname,
  '../features/rotas/application/route-confirmation-orchestrator.ts',
);
const orchestratorSource = readFileSync(ORCHESTRATOR_PATH, 'utf-8');

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

  describe('confirmação de rota — orquestrador de produção', () => {
    it('panel delega a máquina de estados ao módulo application', () => {
      expect(panelSource).toContain('createRouteConfirmationOrchestrator');
      expect(panelSource).toContain('routeConfirmationOrchestrator.confirm(request)');
      expect(panelSource).not.toContain('isConfirmingRoute');
    });

    it('orquestrador não depende de Firebase, DOM ou localStorage', () => {
      expect(orchestratorSource).not.toContain('firebase');
      expect(orchestratorSource).not.toContain('document.');
      expect(orchestratorSource).not.toContain('window.');
      expect(orchestratorSource).not.toContain('localStorage');
    });

    it('lock é adquirido no módulo e liberado em finally', () => {
      expect(orchestratorSource).toContain('if (locked)');
      expect(orchestratorSource).toContain('locked = true');
      expect(orchestratorSource).toMatch(/finally\s*\{\s*locked = false/);
    });

    it('operationId usa somente routeId + serviceId', () => {
      expect(orchestratorSource).toContain('`${route.id}:${serviceId}`');
      expect(orchestratorSource).not.toMatch(/operationId:\s*`[^`]*cliente/);
      expect(orchestratorSource).not.toMatch(/operationId:\s*`[^`]*valor/);
    });

    it('newService gera serviceId permanente com UUID', () => {
      expect(panelSource).toMatch(/function\s+newService\s*\(\)\s*\{.*svc-.*crypto\.randomUUID\(\)/);
      expect(panelSource).toContain('generateServiceId: () => `svc-${crypto.randomUUID()}`');
    });

    it('routeId usa UUID e não Date.now', () => {
      expect(panelSource).toContain('generateRouteId: () => `rota-${crypto.randomUUID()}`');
      expect(panelSource).not.toContain('rota-${Date.now()}');
    });

    it('retry do botão principal reutiliza tentativa pending', () => {
      expect(panelSource).toContain('activePendingRouteId');
      expect(panelSource).toContain("route.status === 'pending'");
      expect(panelSource).toContain("kind:'pending', route");
    });

    it('histórico pending oferece Retomar confirmação pelo mesmo orquestrador', () => {
      expect(panelSource).toContain('data-resume-route');
      expect(panelSource).toContain('Retomar confirmação');
      expect(panelSource).toContain('resumePendingRoute(route)');
    });

    it('botão Retomar confirmação aparece somente para status pending', () => {
      expect(panelSource).toMatch(
        /route\.id\s*&&\s*route\.status\s*===\s*'pending'\s*\?\s*`<button[^`]*data-resume-route/,
      );
      expect(panelSource.match(/data-resume-route/g)).toHaveLength(2);
    });

    it('panel não mantém caminho antigo de persistência fora do orquestrador', () => {
      expect(panelSource).not.toContain('applyRoutePendingsDual');
      expect(panelSource).not.toContain('novaRota');
      expect(panelSource).not.toContain('isConfirmingRoute');

      const compositionStart = panelSource.indexOf(
        'const routeConfirmationOrchestrator = createRouteConfirmationOrchestrator',
      );
      const compositionEnd = panelSource.indexOf(
        'function reportRouteConfirmationFailure',
        compositionStart,
      );
      const composition = panelSource.slice(compositionStart, compositionEnd);
      expect(composition.match(/window\.__motoboyRotas\.save\(/g)).toHaveLength(1);
      expect(composition.match(/applyRouteFinancialPendings\(/g)).toHaveLength(1);

      const outsideComposition =
        panelSource.slice(0, compositionStart) + panelSource.slice(compositionEnd);
      expect(outsideComposition).not.toContain('window.__motoboyRotas.save(');
      expect(outsideComposition).not.toContain('applyRouteFinancialPendings(');
    });

    it('efeitos de sucesso ficam concentrados em completeLocally', () => {
      const completion = extractFunction(panelSource, 'completeRouteConfirmationLocally');
      expect(completion).toContain('upsertRouteLocally(route)');
      expect(completion).toContain('entradas.unshift');
      expect(completion).toContain('routeServices = [ newService() ]');
      expect(completion).toContain('showRouteConfirmationSuccess(route)');
      expect(orchestratorSource).toContain('dependencies.completeLocally(confirmedRoute)');
    });

    it('confirmação não dispara sync legado de moto ou clientes', () => {
      const run = extractFunction(panelSource, 'runRouteConfirmation');
      const completion = extractFunction(panelSource, 'completeRouteConfirmationLocally');
      expect(run + completion).not.toContain('syncMotoToFirestore');
      expect(run + completion).not.toContain('syncClientsToFirestore');
    });

    it('rota pending não entra no dashboard e permanece visível no histórico', () => {
      const dashIdx = panelSource.indexOf('routesToday = confirmedRoutes.filter');
      expect(panelSource.slice(dashIdx, dashIdx + 140)).toContain("status !== 'pending'");
      const years = extractFunction(panelSource, 'routeHistoryYears');
      expect(years).toContain('confirmedRoutes.forEach');
      expect(years).not.toContain("status !== 'pending'");
      expect(panelSource).toContain('route-pending-badge');
    });

    it('transição confirmed→pending continua rejeitada no Firestore', () => {
      expect(repoSource).toContain('runTransaction');
      expect(repoSource).toContain('já está confirmada — não pode voltar para pending');
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
