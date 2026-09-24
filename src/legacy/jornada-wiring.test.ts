import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Verificação estática da Etapa 2: feature Jornada (início/fim pelo hodômetro)
 * e a ocultação beta da navegação de Rotas.
 *
 * Seguimos o padrão de panel-sync.test.ts / pending-sync-wiring.test.ts: o
 * monólito não roda em runtime nos testes, então checamos o código-fonte. As
 * regras da jornada (uma em aberto por usuário, km final >= inicial, fecho
 * idempotente, custo estimado que nunca vira despesa) são testadas em runtime
 * em src/features/jornada/**.
 */

const panelSource = readFileSync(resolve(__dirname, './panel.js'), 'utf-8');
const indexSource = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const mainSource = readFileSync(resolve(__dirname, '../main.ts'), 'utf-8');

describe('painel recebe jornadas do Firestore e mescla pendências', () => {
  it('expõe __applyRemoteJornada com merge de pendências locais', () => {
    expect(panelSource).toContain('window.__applyRemoteJornada = function(entities)');
    expect(panelSource).toContain('mergeRemoteWithPending(remoteVMs, jornadas)');
  });

  it('jornadas entra no estado local para a recarga não apagar o pendente', () => {
    expect(panelSource).toContain('let jornadas = Array.isArray(localState.jornadas) ? localState.jornadas : [];');
    expect(panelSource).toContain('jornadas,');
  });

  it('iniciar e encerrar passam pela ponte __motoboyJornada', () => {
    expect(panelSource).toContain('window.__motoboyJornada.start(r)');
    expect(panelSource).toContain('window.__motoboyJornada.close(record.fsId, {');
  });

  it('o custo estimado é derivado e nunca é gravado como despesa/entrada', () => {
    expect(panelSource).toContain('custoEstimado = (consumoReferencia && precoReferencia)');
    // A jornada não salva em entradas: o bloco de jornada não chama __motoboyEntradas.
    const jornadaBlock = panelSource.indexOf('function startJornadaFromCard');
    const jornadaSlice = panelSource.slice(jornadaBlock, panelSource.indexOf('function renderDashboard(){', jornadaBlock));
    expect(jornadaSlice).not.toContain('__motoboyEntradas');
  });

  it('a origem do custo vem de moto-config (manual) ou histórico de abastecimentos', () => {
    expect(panelSource).toContain("const origemConsumo = consumoManualDefinido ? 'moto' : (consumoReal && consumoReal > 0 ? 'historico' : null)");
    expect(panelSource).toContain("const origemPreco = precoReferencia ? 'abastecimento' : null");
  });
});

describe('main.ts conecta a bridge de jornada', () => {
  it('importa, instala e carrega a jornada', () => {
    expect(mainSource).toContain("from './features/jornada/presentation/panel-bridge'");
    expect(mainSource).toContain('installJornadaBridge,');
    expect(mainSource).toContain('loadJornadaIntoPanel,');
    expect(mainSource).toContain('installJornadaBridge();');
    expect(mainSource).toContain('void loadJornadaIntoPanel();');
  });
});

describe('beta oculta a navegação de Rotas sem apagar o fluxo', () => {
  it('esconde os itens do menu e as views de rotas/histórico', () => {
    expect(indexSource).toContain('class="drawer-item drawer-hidden" data-view="rotas"');
    expect(indexSource).toContain('class="drawer-item drawer-hidden" data-view="historico-rotas"');
    const rotasView = indexSource.match(/<main class="view view-hidden" id="view-rotas">/);
    const historicoView = indexSource.match(/<main class="view view-hidden" id="view-historico-rotas">/);
    expect(rotasView).toBeTruthy();
    expect(historicoView).toBeTruthy();
  });

  it('o atalho do dashboard deixa de apontar para rotas', () => {
    const shortcutLine = panelSource.split('\n').find((line) => line.includes('dashboardRouteShortcut'));
    expect(shortcutLine).toContain("setView('dashboard')");
  });

  it('após iniciar rota, o overlay não volta para a view oculta', () => {
    expect(panelSource).toContain("setView('dashboard');");
  });

  it('o card de jornada existe no dashboard e o botão é montado no painel', () => {
    expect(indexSource).toContain('id="jornadaCard"');
    expect(panelSource).toContain('id="jornadaStartBtn"');
  });
});