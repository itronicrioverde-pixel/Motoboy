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
 * - Ausência do writer financeiro agregado e debounced
 * - Escritas financeiras transacionais
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

const CLIENT_WRITER_PATH = resolve(
  __dirname,
  '../features/customers/infrastructure/client-writer.ts',
);
const clientWriterSource = readFileSync(CLIENT_WRITER_PATH, 'utf-8');

const RECEIPT_MANAGER_PATH = resolve(
  __dirname,
  '../features/customers/application/receipt-submission-manager.ts',
);
const receiptManagerSource = readFileSync(RECEIPT_MANAGER_PATH, 'utf-8');

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

    it('saveMotoToFirestore tem guarda if(!motoHydrated.isOpen) return', () => {
      const block = extractFunction(panelSource, 'saveMotoToFirestore');
      expect(block).toMatch(/if\s*\(\s*!motoHydrated\.isOpen\s*\)\s*return/);
    });
  });

  describe('recebimento — submissão transacional com lock e retry no manager', () => {
    it('não mantém writer debounced para clients/data', () => {
      expect(panelSource).not.toContain('clientsWriter');
      expect(panelSource).not.toContain('saveClientsToFirestore');
      expect(panelSource).not.toContain('syncClientsToFirestore');
    });

    it('importa e compõe manager + controlador; não chama applyReceiptDual diretamente no fluxo', () => {
      expect(panelSource).toContain("import { createReceiptSubmissionManager } from");
      expect(panelSource).toContain('const receiptSubmissionManager = createReceiptSubmissionManager');
      expect(panelSource).toContain("import { createReceiptSubmissionController } from");
      expect(panelSource).toContain('const receiptSubmissionController = createReceiptSubmissionController');

      const start = panelSource.indexOf("document.getElementById('recebimentoSave')");
      const end = panelSource.indexOf('const clienteModalCtl', start);
      const body = panelSource.slice(start, end);
      expect(body).not.toContain('applyReceiptDual');
      expect(body).not.toContain("localStorage.getItem('pendingReceipt')");
      expect(body).not.toContain('entradas.unshift');
      expect(body).toContain('receiptSubmissionController.submit');
      expect(body).toContain('retryPendingReceipt');
    });

    it('falha mantém o modal aberto sem criar faturamento nem alterar o cache local', () => {
      expect(panelSource).toContain('handleReceiptSubmissionFailure');
      expect(panelSource).toContain('catch(err)');
      const success = extractFunction(panelSource, 'applyReceiptSuccess');
      expect(success).toContain('applyReceiptResult({ clientes, entradas }, result)');
      expect(success).toContain('saveLocalState()');
      expect(success).toContain('renderFaturamento()');
    });

    it('lock compartilhado entre submit e retry fica no manager (painel não mantém savingReceipt)', () => {
      expect(panelSource).toContain('createReceiptSubmissionManager');
      expect(panelSource).not.toContain('savingReceipt');
      expect(panelSource).not.toMatch(/let savingReceipt\b/);
    });

    it('receiptOperationId é gerado na composição do manager, não dentro do handler', () => {
      const start = panelSource.indexOf("document.getElementById('recebimentoSave')");
      const end = panelSource.indexOf('const clienteModalCtl', start);
      const body = panelSource.slice(start, end);
      expect(body).not.toContain('crypto.randomUUID()');

      const compositionStart = panelSource.indexOf('const receiptSubmissionManager = createReceiptSubmissionManager');
      const compositionEnd = panelSource.indexOf('let receiptPendingMode', compositionStart);
      const composition = panelSource.slice(compositionStart, compositionEnd);
      expect(composition).toContain('generateReceiptOperationId: () => `receipt-${crypto.randomUUID()}`');
    });

    it('tentativa pendente oferece retomada por banner e modal em modo pendente', () => {
      expect(panelSource).toContain('data-action="pending-receipt"');
      expect(panelSource).toContain('Retomar recebimento');
      expect(panelSource).toContain('enterReceiptPendingMode');
      expect(panelSource).toContain('retryPendingReceipt');
      expect(panelSource).toContain('receiptSubmissionController.retry');
    });

    it('controlador não acessa banco remoto, DOM, janela global nem armazenamento', () => {
      const controllerSource = readFileSync(
        resolve(__dirname, '../features/customers/presentation/receipt-submission-controller.ts'),
        'utf-8',
      );
      expect(controllerSource).not.toContain('firebase');
      expect(controllerSource).not.toContain('document.');
      expect(controllerSource).not.toContain('window.');
      expect(controllerSource).not.toContain('localStorage');
    });

    it('manager não acessa banco remoto, DOM, janela global nem armazenamento', () => {
      expect(receiptManagerSource).not.toContain('firebase');
      expect(receiptManagerSource).not.toContain('document.');
      expect(receiptManagerSource).not.toContain('window.');
      expect(receiptManagerSource).not.toContain('localStorage');
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

    it('writer constrói operationId somente de routeId + serviceId', () => {
      expect(clientWriterSource).toContain('`${normalizedRouteId}:${serviceId}`');
      expect(clientWriterSource).not.toMatch(/operationId:\s*`[^`]*nome/);
      expect(clientWriterSource).not.toMatch(/operationId:\s*`[^`]*valor/);
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

    it('resolução de clientId rejeita ambiguidade de nomes no painel', () => {
      expect(panelSource).toContain('matches.length > 1');
      expect(panelSource).toContain('Renomeie um deles');
      expect(panelSource).toContain('s.clientId = matches[0].id');
    });
  });

  describe('rota de cancelamento — cancelamento atômico', () => {
    it('cancelConfirmedRoute é async e usa cancelAtomic', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('cancelAtomic');
      expect(body).toContain('await');
    });

    it('aplica estado atômico do Firestore localmente após commit', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('updatedClientes');
      expect(body).toContain('clientes = updatedClientes');
      expect(body).not.toContain('clientes.find');
    });

    it('trata erro e mostra toast', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('catch(err)');
      expect(body).toContain("showToast('Erro ao cancelar rota no servidor");
    });

    it('ponte ausente aborta com toast em vez de fallback', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('Ponte de cancelamento atômico indisponível');
      expect(body).not.toMatch(/syncClientsToFirestore/);
    });

    it('nenhum estado local é alterado antes do commit remoto', () => {
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      const awaitPos = body.indexOf('await window.__motoboyRotas.cancelAtomic');
      const splicePos = body.indexOf('confirmedRoutes.splice');
      const entradasPos = body.indexOf('entradas[i].routeId');
      expect(awaitPos).toBeGreaterThan(-1);
      expect(splicePos).toBeGreaterThan(awaitPos);
      expect(entradasPos).toBeGreaterThan(awaitPos);
    });

    it('lock cancellingRoute impede duplo-clique', () => {
      expect(panelSource).toContain('cancellingRoute');
      const body = extractFunction(panelSource, 'cancelConfirmedRoute');
      expect(body).toContain('if(cancellingRoute) return');
      expect(body).toContain('cancellingRoute = true');
      expect(body).toMatch(/finally\s*\{[^}]*cancellingRoute\s*=\s*false/);
    });
  });

  describe('dual source — SyncGate import e uso', () => {
    it('panel.js importa gates do módulo panel-hydration', () => {
      expect(panelSource).toContain("import { clientsHydrated, motoHydrated } from");
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

  describe('cancelamento — remove() removido', () => {
    it('panel.js não chama __motoboyRotas.remove()', () => {
      expect(panelSource).not.toContain('__motoboyRotas.remove');
    });

    it('panel.js não chama rotasService.remove()', () => {
      expect(panelSource).not.toContain('rotasService.remove');
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
