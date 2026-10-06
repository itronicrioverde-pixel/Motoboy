import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const panelSource = readFileSync(resolve(__dirname, './panel.js'), 'utf-8');

describe('panel.js — motivo de edição financeira', () => {
  it.each([
    ['btnSaveRefuel', '__motoboyAbastecimentos.update'],
    ['maintSave', '__motoboyManutencoes.update'],
    ['entradaSave', '__motoboyEntradas.update'],
  ])('%s envia o motivo capturado antes da escrita remota', (buttonId, remoteUpdate) => {
    const start = panelSource.indexOf(`getElementById('${buttonId}').addEventListener('click'`);
    expect(start).toBeGreaterThanOrEqual(0);
    const update = panelSource.indexOf(remoteUpdate, start);
    expect(update).toBeGreaterThan(start);
    const beforeUpdate = panelSource.slice(start, update);
    const recordStart = beforeUpdate.lastIndexOf('const record = {');
    expect(recordStart).toBeGreaterThanOrEqual(0);
    const recordEnd = beforeUpdate.indexOf('};', recordStart);
    expect(beforeUpdate.slice(recordStart, recordEnd)).toContain('editReason');
    expect(beforeUpdate).toContain('const editReason =');
  });
});
