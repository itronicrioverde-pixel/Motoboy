import { describe, it, expect } from 'vitest';
import { mergeLegacyCustomers, type LegacyCliente } from './merge-legacy-customers';

function cliente(overrides: Partial<LegacyCliente> & { nome: string }): LegacyCliente {
  return { pendente: 0, contas: [], recebimentos: [], ...overrides };
}

describe('mergeLegacyCustomers', () => {
  describe('associação por ID estável', () => {
    it('preserva dados financeiros locais quando remoto não os possui', () => {
      const local = [cliente({ id: 'c1', nome: 'Ana', pendente: 50, contas: [{ saldo: 50 }], recebimentos: [{ valor: 10 }] })];
      const remote = [cliente({ id: 'c1', nome: 'Ana' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('c1');
      expect(merged[0].contas).toEqual([{ saldo: 50 }]);
      expect(merged[0].recebimentos).toEqual([{ valor: 10 }]);
      expect(merged[0].pendente).toBe(50);
    });

    it('cliente renomeado não duplica quando possui ID', () => {
      const local = [cliente({ id: 'c1', nome: 'Ana Costa', pendente: 30, contas: [{ saldo: 30 }], recebimentos: [] })];
      const remote = [cliente({ id: 'c1', nome: 'Ana Silva' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(1);
      expect(merged[0].nome).toBe('Ana Silva');
      expect(merged[0].pendente).toBe(30);
    });

    it('remoto com dados financeiros próprios preserva os seus, não os locais', () => {
      const local = [cliente({ id: 'c1', nome: 'Ana', contas: [{ saldo: 10 }], recebimentos: [], pendente: 10 })];
      const remote = [cliente({ id: 'c1', nome: 'Ana', contas: [{ saldo: 99 }], recebimentos: [{ valor: 5 }], pendente: 99 })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged[0].contas).toEqual([{ saldo: 99 }]);
      expect(merged[0].recebimentos).toEqual([{ valor: 5 }]);
      expect(merged[0].pendente).toBe(99);
    });
  });

  describe('fallback por nome normalizado (legado sem ID)', () => {
    it('associa por nome quando local não tem ID', () => {
      const local = [cliente({ nome: 'Maria', pendente: 20, contas: [{ saldo: 20 }], recebimentos: [] })];
      const remote = [cliente({ id: 'c2', nome: 'Maria' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('c2');
      expect(merged[0].pendente).toBe(20);
    });

    it('ignora nome quando local já tem ID diferente', () => {
      const local = [cliente({ id: 'c3', nome: 'João', pendente: 15, contas: [{ saldo: 15 }], recebimentos: [] })];
      const remote = [cliente({ id: 'c4', nome: 'João' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(2);
      const remoteResult = merged.find(c => c.id === 'c4');
      const localResult = merged.find(c => c.id === 'c3');
      expect(remoteResult!.pendente).toBe(0);
      expect(localResult!.pendente).toBe(15);
    });

    it('normaliza case e espaços no nome', () => {
      const local = [cliente({ nome: '  carlos  ', pendente: 5, contas: [{ saldo: 5 }], recebimentos: [] })];
      const remote = [cliente({ id: 'c5', nome: 'Carlos' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(1);
      expect(merged[0].pendente).toBe(5);
    });
  });

  describe('dois clientes com o mesmo nome', () => {
    it('não funde incorretamente quando ambos têm IDs diferentes', () => {
      const local = [
        cliente({ id: 'c1', nome: 'Ana', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] }),
        cliente({ id: 'c2', nome: 'Ana', pendente: 20, contas: [{ saldo: 20 }], recebimentos: [] }),
      ];
      const remote = [
        cliente({ id: 'c1', nome: 'Ana' }),
        cliente({ id: 'c2', nome: 'Ana' }),
      ];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(2);
      expect(merged.find(c => c.id === 'c1')!.pendente).toBe(10);
      expect(merged.find(c => c.id === 'c2')!.pendente).toBe(20);
    });

    it('fallback por nome associa no máximo um local sem ID', () => {
      const local = [
        cliente({ nome: 'Ana', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] }),
        cliente({ nome: 'Ana', pendente: 20, contas: [{ saldo: 20 }], recebimentos: [] }),
      ];
      const remote = [cliente({ id: 'c1', nome: 'Ana' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(2);
      const matched = merged.find(c => c.id === 'c1')!;
      expect(matched.pendente).toBe(10);
      const unmatched = merged.find(c => !c.id)!;
      expect(unmatched.pendente).toBe(20);
    });
  });

  describe('cliente remoto novo', () => {
    it('inicia sem dados financeiros locais', () => {
      const local = [cliente({ id: 'c1', nome: 'Ana', pendente: 10, contas: [{ saldo: 10 }], recebimentos: [] })];
      const remote = [
        cliente({ id: 'c1', nome: 'Ana' }),
        cliente({ id: 'c99', nome: 'Novo' }),
      ];

      const { merged } = mergeLegacyCustomers(remote, local);

      const novo = merged.find(c => c.id === 'c99')!;
      expect(novo.contas).toEqual([]);
      expect(novo.recebimentos).toEqual([]);
      expect(novo.pendente).toBe(0);
    });
  });

  describe('cliente local não sincronizado', () => {
    it('preserva cliente local sem correspondência remota', () => {
      const local = [
        cliente({ nome: 'SóLocal', pendente: 5, contas: [{ saldo: 5 }], recebimentos: [] }),
      ];
      const remote = [cliente({ id: 'c1', nome: 'Remoto' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(2);
      const soLocal = merged.find(c => c.nome === 'SóLocal')!;
      expect(soLocal.pendente).toBe(5);
      expect(soLocal.contas).toEqual([{ saldo: 5 }]);
    });

    it('preserva cliente local com ID sem correspondência remota', () => {
      const local = [cliente({ id: 'local-1', nome: 'Pendente', pendente: 100, contas: [{ saldo: 100 }], recebimentos: [] })];
      const remote: LegacyCliente[] = [];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('local-1');
      expect(merged[0].pendente).toBe(100);
    });
  });

  describe('imutabilidade', () => {
    it('não muta objetos remotos recebidos', () => {
      const remote = [cliente({ id: 'c1', nome: 'Ana' })];
      const local = [cliente({ id: 'c1', nome: 'Ana', pendente: 50, contas: [{ saldo: 50 }], recebimentos: [] })];
      const remoteSnapshot = JSON.stringify(remote);

      mergeLegacyCustomers(remote, local);

      expect(JSON.stringify(remote)).toBe(remoteSnapshot);
    });

    it('não muta objetos locais recebidos', () => {
      const remote = [cliente({ id: 'c1', nome: 'Ana' })];
      const local = [cliente({ id: 'c1', nome: 'Ana', pendente: 50, contas: [{ saldo: 50 }], recebimentos: [] })];
      const localSnapshot = JSON.stringify(local);

      mergeLegacyCustomers(remote, local);

      expect(JSON.stringify(local)).toBe(localSnapshot);
    });

    it('arrays financeiros copiados são instâncias independentes', () => {
      const localContas = [{ saldo: 50 }];
      const local = [cliente({ id: 'c1', nome: 'Ana', pendente: 50, contas: localContas, recebimentos: [] })];
      const remote = [cliente({ id: 'c1', nome: 'Ana' })];

      const { merged } = mergeLegacyCustomers(remote, local);

      expect(merged[0].contas).toEqual(localContas);
      expect(merged[0].contas).not.toBe(localContas);
    });
  });

  describe('casos limítrofes', () => {
    it('ambas as listas vazias retorna lista vazia', () => {
      const { merged } = mergeLegacyCustomers([], []);
      expect(merged).toEqual([]);
    });

    it('remote vazio preserva todos os locais', () => {
      const local = [
        cliente({ nome: 'A', pendente: 1, contas: [], recebimentos: [] }),
        cliente({ nome: 'B', pendente: 2, contas: [], recebimentos: [] }),
      ];

      const { merged } = mergeLegacyCustomers([], local);

      expect(merged).toHaveLength(2);
    });

    it('local vazio retorna todos os remotos limpos', () => {
      const remote = [
        cliente({ id: 'c1', nome: 'A' }),
        cliente({ id: 'c2', nome: 'B' }),
      ];

      const { merged } = mergeLegacyCustomers(remote, []);

      expect(merged).toHaveLength(2);
      expect(merged[0].contas).toEqual([]);
      expect(merged[1].contas).toEqual([]);
    });
  });
});
