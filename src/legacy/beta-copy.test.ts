import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('microtexto do beta sem fluxo de rotas', () => {
  it('Moto e Clientes não instruem o usuário a usar a aba oculta de Rotas', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/legacy/panel.js'), 'utf8');
    const motoStatus = readFileSync(resolve(process.cwd(), 'src/features/moto/presentation/manual-consumption-status.ts'), 'utf8');
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(panel).not.toContain('usados nas rotas');
    expect(panel).not.toContain('usado nas rotas');
    expect(panel).not.toContain('em um serviço da rota.</div>');
    expect(motoStatus).toContain('para estimar jornadas');
    expect(html).not.toContain('Quando um serviço for marcado como "Fica pra depois"');
    expect(html).toContain('Acompanhe as contas em aberto dos clientes.');
  });
});
