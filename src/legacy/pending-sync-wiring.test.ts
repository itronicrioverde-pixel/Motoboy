import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const panelSource = readFileSync(resolve(__dirname, './panel.js'), 'utf-8');

function sliceFrom(startMarker: string, endMarker: string): string {
  const start = panelSource.indexOf(startMarker);
  const end = panelSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Marcador do painel ausente: ${startMarker}`);
  return panelSource.slice(start, end);
}

const refuelSave = sliceFrom("document.getElementById('btnSaveRefuel').addEventListener", '// Ponte: recebe os abastecimentos');
const maintenanceSave = sliceFrom("document.getElementById('maintSave').addEventListener", '// Ponte: recebe as manutenções');
const entrySave = sliceFrom("document.getElementById('entradaSave').addEventListener", '// ---------- rotas: montador de serviços');

describe('painel usa a criação durável nos três fluxos', () => {
  it.each([
    ['abastecimento', refuelSave, '__motoboyAbastecimentos', 'retryRefuel'],
    ['manutenção', maintenanceSave, '__motoboyManutencoes', 'retryMaintenance'],
    ['entrada', entrySave, '__motoboyEntradas', 'retryEntry'],
  ])('%s: prepara antes do envio, persiste pendência e reusa ID no botão Salvar', (_name, body, bridge, retry) => {
    expect(body).toContain(`window.${bridge}.prepare(record)`);
    expect(body).toContain('record.pendingCreateId = attempt.id');
    expect(body).toContain('record.pendingUid = attempt.uid');
    expect(body).toMatch(/record\.pendingCreateId = attempt\.id;[\s\S]*saveLocalState\(\);[\s\S]*retry/);
    expect(body).toContain(`${retry}(`);
    expect(body).not.toContain(`window.${bridge}.add(`);
    expect(body).not.toContain('settleLocalAdd(record,');
  });

  it('ação de retry substitui editar/excluir, e o badge nunca diz salvo sem confirmação', () => {
    const actions = sliceFrom('function recordActionsHTML(', 'function updateStorageStatus(');
    expect(actions).toContain('if(record && record.pendingCreateId)');
    expect(actions).toContain('data-record-action="retry"');
    expect(actions).toContain('Tentar novamente');
    const badge = sliceFrom('function syncBadgeHTML(', 'function retryRefuel(');
    expect(badge).toContain('Aguardando conexão');
    expect(badge).toContain('Não confirmado');
    expect(badge).not.toContain('Salvo');
  });

  it('confirma sucesso só depois do retry remoto, sem duas callbacks de clique simultâneo', () => {
    const retry = sliceFrom('function retryDurableRecord(', 'function retryRefuel(');
    expect(retry).toContain('durableRetryUiInFlight.has(record)');
    expect(retry).toContain('bridge.retry(id)');
    expect(retry).toMatch(/bridge\.retry\(id\)[\s\S]*\.then\(function\(result\)/);
    expect(retry).toContain("record.syncState = 'saved'");
    expect(retry).toContain('onConfirmed(record)');
    expect(retry).toContain("record.syncState = 'failed'");
    expect(retry).toContain("record.syncState = 'awaiting'");
    expect(retry).toContain("result === 'removed'");
  });

  it('recarga reconstrói os três registros somente das tentativas por UID', () => {
    expect(panelSource).toContain('function restoreCreateAttempts(');
    expect(panelSource).toContain('bridge.pending()');
    expect(panelSource).toContain('pendingRefuelToVM');
    expect(panelSource).toContain('pendingMaintenanceToVM');
    expect(panelSource).toContain('pendingEntryToVM');
    expect(panelSource).toContain('pendingUid:attempt.uid');
    expect(panelSource).toContain('pendingCreateId:attempt.id');
  });

  it('recarga remota não duplica documento confirmado quando resposta original se perdeu', () => {
    expect(panelSource).toContain('mergeRemoteWithPending(remoteVMs, refuels)');
    expect(panelSource).toContain('mergeRemoteWithPending(remoteVMs, maintenances)');
    expect(panelSource).toContain('remoto.filter(e => !pendingIds.has(e.fsId)).concat(locaisPreservadas)');
  });

  it('não permite alterar registros sem confirmação e não soma pendências no faturamento', () => {
    expect(panelSource).toContain("if(item.pendingCreateId){ showToast('Confirme o abastecimento antes de editar.");
    expect(panelSource).toContain("if(item.pendingCreateId){ showToast('Confirme o gasto antes de excluir.");
    expect(panelSource).toContain("if(item.pendingCreateId){ showToast('Confirme a entrada antes de excluir.");
    expect(panelSource).toContain('function confirmedRecords(records)');
    expect(panelSource).toContain('monthRecords(confirmedRecords(entradas), monthKey)');
    expect(panelSource).toContain('monthRecords(confirmedRecords(refuels), monthKey)');
    expect(panelSource).toContain('monthRecords(confirmedRecords(maintenances), monthKey)');
  });

  it('edições e exclusões confirmadas ainda aguardam a resposta remota', () => {
    for (const [bridge, body] of [
      ['__motoboyAbastecimentos', refuelSave],
      ['__motoboyManutencoes', maintenanceSave],
      ['__motoboyEntradas', entrySave],
    ] as const) {
      expect(body).toContain(`window.${bridge}.update(record.fsId, record)`);
      expect(body).toContain('A alteração não foi aplicada.');
    }
    expect(panelSource).toContain('window.__motoboyAbastecimentos.remove(item.fsId)');
    expect(panelSource).toContain('window.__motoboyManutencoes.remove(item.fsId)');
    expect(panelSource).toContain('window.__motoboyEntradas.remove(item.fsId)');
  });
});

describe('bridges expõem apenas criação idempotente no caminho ativo', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf-8');
  const bridges = [
    ['abastecimentos', read('../features/abastecimentos/presentation/panel-bridge.ts')],
    ['manutencoes', read('../features/manutencoes/presentation/panel-bridge.ts')],
    ['entradas', read('../features/faturamento/presentation/panel-bridge.ts')],
  ] as const;

  it.each(bridges)('%s: prepara, lista e reenvia a mesma tentativa', (kind, source) => {
    expect(source).toContain(`durableCreateManager.prepare('${kind}'`);
    expect(source).toContain(`durableCreateManager.pending('${kind}')`);
    expect(source).toContain(`durableCreateManager.retry('${kind}', id)`);
    expect(source).not.toMatch(/async add\(vm\)/);
  });
});
