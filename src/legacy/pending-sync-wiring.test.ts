import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Verificação estática do painel legado (panel.js) + bridges para a confirmação
 * de escrita "salvo / pendente / falhou" de abastecimentos, manutenções e
 * entradas manuais.
 *
 * O monólito não pode ser unit-tested diretamente (efeitos colaterais, DOM);
 * seguimos o mesmo padrão de panel-sync.test.ts. As regras de transição com
 * promessas controladas vivem em src/shared/application/pending-local-write.ts
 * (testado em runtime); aqui garantimos que o painel realmente as usa e não
 * volta a anunciar sucesso antes da confirmação remota.
 */

const PANEL_PATH = resolve(__dirname, './panel.js');
const panelSource = readFileSync(PANEL_PATH, 'utf-8');

function sliceFrom(cursorMarker: string, untilMarker: string): string {
  const start = panelSource.indexOf(cursorMarker);
  const end = panelSource.indexOf(untilMarker, start);
  if (start < 0 || end < 0) return '';
  return panelSource.slice(start, end);
}

const REFUEL_BODY = sliceFrom("document.getElementById('btnSaveRefuel')", '// Ponte: recebe os abastecimentos');
const MAINT_BODY = sliceFrom("document.getElementById('maintSave')", '// Ponte: recebe as manutenções');
const ENTRY_BODY = sliceFrom("document.getElementById('entradaSave')", '// ---------- rotas: montador de serviços');

describe('panel.js usa o ciclo pendente/salvo/falhou nos três fluxos', () => {
  it('importa settleLocalAdd e mergeRemoteWithPending do módulo compartilhado', () => {
    expect(panelSource).toContain(
      "import { settleLocalAdd, mergeRemoteWithPending } from '../shared/application/pending-local-write';",
    );
  });

  it('abastecimento: marcador pending antes do remoto e nenhum sucesso imediato', () => {
    expect(REFUEL_BODY).toContain(`record.syncState = 'pending';`);
    expect(REFUEL_BODY).toContain('settleLocalAdd(record,');
    expect(REFUEL_BODY).not.toContain('showToast(`${wasEditing');
  });

  it('abastecimento: falha vira "failed", mantém o formulário carregado e libera o lock', () => {
    expect(REFUEL_BODY).toContain(`r.syncState = 'failed';`);
    expect(REFUEL_BODY).toContain('editingRefuelIndex = idx;');
    expect(REFUEL_BODY).toContain('onSettled(){ refuelWriteBusy = false; }');
    expect(REFUEL_BODY).toContain('"Não salvo"');
  });

  it('abastecimento: edição confirmada só aplica na UI após `.then` do remoto', () => {
    expect(REFUEL_BODY).toContain('window.__motoboyAbastecimentos.update(record.fsId, record)');
    expect(REFUEL_BODY).toContain('A alteração não foi aplicada.');
    expect(REFUEL_BODY).toMatch(/\.then\(function\(\)\{[\s\S]*Abastecimento atualizado/);
    expect(REFUEL_BODY).toMatch(/\.finally\(function\(\)\{ refuelWriteBusy = false; \}\)/);
  });

  it('abastecimento: exclusão aguarda o remoto e tem caminho local para criação pendente', () => {
    const refuelDelete = sliceFrom('function deleteRefuel(', 'function removeRefuelLocally');
    expect(refuelDelete).toContain('refuelWriteBusy');
    expect(refuelDelete).toContain('.remove(item.fsId)');
    expect(refuelDelete).toContain('removeRefuelLocally(currentIndex, item)');
    expect(panelSource).toContain('function removeRefuelLocally');
  });

  it('manutenção: pendente/remoto/tombo/UID e sucesso só após confirmação', () => {
    expect(MAINT_BODY).toContain('settleLocalAdd(record,');
    expect(MAINT_BODY).toContain('onOrphanRemoval(remoteId)');
    expect(MAINT_BODY).toContain('uidAtWrite === currentUid()');
    expect(MAINT_BODY).toContain('onSettled(){ maintWriteBusy = false; }');
    expect(MAINT_BODY).toContain('window.__motoboyManutencoes.update(record.fsId, record)');
    expect(MAINT_BODY).not.toContain('showToast(`${wasEditing');
  });

  it('entrada manual: mesmo ciclo com pendente/falhou e edição aguardando remoto', () => {
    expect(ENTRY_BODY).toContain('settleLocalAdd(record,');
    expect(ENTRY_BODY).toContain(`record.syncState = 'pending';`);
    expect(ENTRY_BODY).toContain(`r.syncState = 'failed';`);
    expect(ENTRY_BODY).toContain('window.__motoboyEntradas.update(record.fsId, record)');
    expect(ENTRY_BODY).toContain('onSettled(){ entryWriteBusy = false; }');
    expect(ENTRY_BODY).not.toContain('showToast(`${wasEditing');
    expect(ENTRY_BODY).not.toContain('/* falha remota: mantém o cache local sem fsId */');
  });

  it('exclusão de manutenção e de entrada aguardam o remoto', () => {
    const maintDelete = sliceFrom('function deleteMaintenance(', 'function removeMaintLocally');
    expect(maintDelete).toContain('.remove(item.fsId)');
    expect(maintDelete).toContain('removeMaintLocally(currentIndex, item)');
    const entryDelete = sliceFrom('function deleteEntry(', 'function removeEntryLocally');
    expect(entryDelete).toContain('.remove(item.fsId)');
    expect(entryDelete).toContain('removeEntryLocally(currentIndex, item)');
  });

  it('recarga remota mescla sem apagar pendências (refuels e manutenções)', () => {
    const applyRefuels = sliceFrom('window.__applyRemoteAbastecimentos', '// ---------- menu / drawer ----------');
    expect(applyRefuels).toContain('mergeRemoteWithPending(remoteVMs, refuels)');
    const applyMaint = sliceFrom('window.__applyRemoteManutencoes', '// ---------- faturamento: entradas + despesas ----------');
    expect(applyMaint).toContain('mergeRemoteWithPending(remoteVMs, maintenances)');
  });

  it('proteção de troca de UID presente nos três fluxos de escrita', () => {
    expect(REFUEL_BODY).toContain('const uidAtWrite = currentUid();');
    expect(MAINT_BODY).toContain('const uidAtWrite = currentUid();');
    expect(ENTRY_BODY).toContain('const uidAtWrite = currentUid();');
  });

  it('badge de sync é renderizado nas listas de abastecimentos, manutenções e entradas', () => {
    const uses = (panelSource.match(/syncBadgeHTML\([a-zA-Z]+\)/g) || []).map(m => m);
    expect(uses).toEqual(expect.arrayContaining(['syncBadgeHTML(r)', 'syncBadgeHTML(m)', 'syncBadgeHTML(e)']));
    expect(panelSource).toContain('syncBadgeHTML(record)');
    expect(panelSource).toContain('class="sync-badge failure"');
    expect(panelSource).toContain('class="sync-badge pending"');
  });
});

describe('bridges não engolem mais falhas de update/remove', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');
  const refuelBridge = read('../features/abastecimentos/presentation/panel-bridge.ts');
  const maintBridge = read('../features/manutencoes/presentation/panel-bridge.ts');
  const entryBridge = read('../features/faturamento/presentation/panel-bridge.ts');

  for (const [name, src] of [
    ['abastecimentos', refuelBridge],
    ['manutenções', maintBridge],
    ['entradas', entryBridge],
  ]) {
    it(`${name}: update e remove propagam erro em vez de manter cache local`, () => {
      expect(src).not.toContain('mantém o cache local');
      expect(src).toMatch(/async update\(fsId, vm\) \{[\s\S]*?await .*Service\.update\(fsId, vmToEdit\(vm\)\)/);
    });
  }

  it('add ainda devolve id ou null (contrato usado pelo settleLocalAdd)', () => {
    expect(refuelBridge).toContain('return created.id;');
    expect(maintBridge).toContain('return created.id;');
    expect(entryBridge).toContain('return created.id;');
  });
});