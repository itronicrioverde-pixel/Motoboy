import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/firebase.js', () => ({ db: { _type: 'firestore' } }));
vi.mock('../../features/auth/application/auth-service', () => ({
  currentUid: () => mockCurrentUid(),
}));

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ _path: segments.join('/') })),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

const mockCurrentUid = vi.fn().mockReturnValue('uid-1');
import { createFirestoreWriter } from './firestore-writer';
import { SyncGate } from '../application/sync-gate';

function createTestGate(open = true): SyncGate {
  return new SyncGate(open);
}

describe('FirestoreWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCurrentUid.mockReturnValue('uid-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('debounce', () => {
    it('consolida chamadas consecutivas em uma única gravação', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ clientes: [{ nome: 'A' }] });
      writer.schedule({ clientes: [{ nome: 'A' }, { nome: 'B' }] });
      writer.schedule({ clientes: [{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }] });

      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/uid-1/clients/data' }),
        { clientes: [{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }] },
        { merge: true },
      );
    });

    it('grava somente após intervalo de debounce', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(400);
      expect(mockSetDoc).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    it('grava com o snapshot mais recente', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ version: 1 });
      vi.advanceTimersByTime(200);
      writer.schedule({ version: 2 });
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        { version: 2 },
        { merge: true },
      );
    });
  });

  describe('UID capture', () => {
    it('captura UID no agendamento e valida antes de escrever', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockCurrentUid.mockReturnValue('uid-1');
      writer.schedule({ data: 1 });

      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/uid-1/clients/data' }),
        { data: 1 },
        { merge: true },
      );
    });

    it('cancela escrita quando UID muda (logout)', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockCurrentUid.mockReturnValue('uid-1');
      writer.schedule({ data: 1 });

      mockCurrentUid.mockReturnValue(null);
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('cancela escrita quando UID troca para outro usuário', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockCurrentUid.mockReturnValue('uid-1');
      writer.schedule({ data: 1 });

      mockCurrentUid.mockReturnValue('uid-2');
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });

  describe('gate', () => {
    it('não escreve quando gate está fechado', () => {
      const gate = createTestGate(false);
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('escreve quando gate abre após agendamento', () => {
      const gate = createTestGate(false);
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      expect(mockSetDoc).not.toHaveBeenCalled();

      gate.open();
      writer.schedule({ data: 2 });
      vi.advanceTimersByTime(500);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel', () => {
    it('cancel impede gravação pendente', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      writer.cancel();
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('cancel reseta estado interno', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      writer.cancel();
      writer.schedule({ data: 2 });
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        { data: 2 },
        { merge: true },
      );
    });
  });

  describe('pathBuilder', () => {
    it('constrói caminho correto para clientes', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/uid-1/clients/data' }),
        { data: 1 },
        { merge: true },
      );
    });

    it('constrói caminho correto para moto', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'moto', 'data'],
        { gate },
      );

      writer.schedule({ km: 100 });
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/uid-1/moto/data' }),
        { km: 100 },
        { merge: true },
      );
    });
  });

  describe('onError', () => {
    it('chama onError quando setDoc falha', async () => {
      const gate = createTestGate();
      const onError = vi.fn();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate, onError },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));

      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('não chama onError quando setDoc sucesso', async () => {
      const gate = createTestGate();
      const onError = vi.fn();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate, onError },
      );

      mockSetDoc.mockResolvedValue(undefined);
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(onError).not.toHaveBeenCalled();
    });

    it('funciona sem callback onError (loga apenas)', async () => {
      const gate = createTestGate();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('retry', () => {
    it('retry reenvia snapshot após falha', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      mockSetDoc.mockResolvedValue(undefined);
      writer.retry();
      await vi.runAllTimersAsync();

      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(mockSetDoc).toHaveBeenLastCalledWith(
        expect.objectContaining({ _path: 'users/uid-1/clients/data' }),
        { data: 1 },
        { merge: true },
      );
    });

    it('retry não executa quando não há snapshot pendente', () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.retry();
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('retry não executa quando UID mudou (logout)', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      mockCurrentUid.mockReturnValue(null);
      writer.retry();
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    it('retry não executa quando gate está fechado', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      gate.close();
      writer.retry();
      vi.advanceTimersByTime(500);

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    it('retry duplo gera somente uma gravação adicional', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      mockSetDoc.mockResolvedValue(undefined);
      writer.retry();
      writer.retry();
      await vi.runAllTimersAsync();

      expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });

    it('sucesso do retry limpa snapshot e estado de erro', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      mockSetDoc.mockResolvedValue(undefined);
      writer.retry();
      await vi.runAllTimersAsync();

      writer.retry();
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });

    it('novo schedule substitui snapshot que falhou', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      mockSetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      mockSetDoc.mockResolvedValue(undefined);
      writer.schedule({ data: 2 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(mockSetDoc).toHaveBeenLastCalledWith(
        expect.anything(),
        { data: 2 },
        { merge: true },
      );
    });

    it('retry após sucesso não faz nada', async () => {
      const gate = createTestGate();
      const writer = createFirestoreWriter(
        (uid) => ['users', uid, 'clients', 'data'],
        { gate },
      );

      writer.schedule({ data: 1 });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      writer.retry();
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });
  });
});
