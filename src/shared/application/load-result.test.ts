import { describe, it, expect } from 'vitest';
import { isLoadSuccess, loadOk, loadFail } from './load-result';
import type { LoadResult } from './load-result';

describe('LoadResult', () => {
  describe('loadOk', () => {
    it('loadOk([]) continua sendo sucesso', () => {
      const result = loadOk([]);
      expect(result).toEqual({ ok: true, data: [] });
      expect(result.ok).toBe(true);
    });

    it('loadOk(0) não vira falha', () => {
      const result = loadOk(0);
      expect(result).toEqual({ ok: true, data: 0 });
    });

    it('loadOk(false) não vira falha', () => {
      const result = loadOk(false);
      expect(result).toEqual({ ok: true, data: false });
    });

    it("loadOk('') não vira falha", () => {
      const result = loadOk('');
      expect(result).toEqual({ ok: true, data: '' });
    });

    it('cria sucesso com dados', () => {
      const result = loadOk([1, 2, 3]);
      expect(result).toEqual({ ok: true, data: [1, 2, 3] });
    });
  });

  describe('loadFail', () => {
    it('preserva a mesma referência do erro', () => {
      const error = new Error('network');
      const result = loadFail(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });

    it('cria falha com erro unknown', () => {
      const result = loadFail('string error');
      expect(result).toEqual({ ok: false, error: 'string error' });
    });

    it('cria falha com null', () => {
      const result = loadFail(null);
      expect(result).toEqual({ ok: false, error: null });
    });
  });

  describe('isLoadSuccess', () => {
    it('retorna true para sucesso', () => {
      expect(isLoadSuccess(loadOk('data'))).toBe(true);
    });

    it('retorna true para sucesso vazio', () => {
      expect(isLoadSuccess(loadOk([]))).toBe(true);
    });

    it('retorna false para falha', () => {
      expect(isLoadSuccess(loadFail(new Error()))).toBe(false);
    });

    it('type guard estreita o tipo corretamente', () => {
      const result: LoadResult<string[]> = loadOk(['a']);
      if (isLoadSuccess(result)) {
        // TypeScript permite acessar result.data aqui
        expect(result.data).toEqual(['a']);
        expect(result.ok).toBe(true);
      } else {
        throw new Error('deveria ser sucesso');
      }
    });
  });

  describe('discriminated union', () => {
    it('ok:true tem data, ok:false tem error', () => {
      const success: LoadResult<number[]> = loadOk([1]);
      const failure: LoadResult<number[]> = loadFail(new Error());

      if (success.ok) {
        expect(success.data).toEqual([1]);
      }

      if (!failure.ok) {
        expect(failure.error).toBeInstanceOf(Error);
      }
    });

    it('ok:false não tem data', () => {
      const result = loadFail(new Error('fail'));
      expect(result).not.toHaveProperty('data');
      expect(result).toHaveProperty('error');
    });
  });
});
