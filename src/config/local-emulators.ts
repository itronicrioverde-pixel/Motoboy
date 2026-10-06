/** Garante que o modo de teste nunca aponte para um projeto Firebase real. */
export function shouldUseLocalEmulators(
  enabled: boolean,
  development: boolean,
  projectId: string | undefined,
): boolean {
  if (!enabled) return false;
  if (!development || !projectId?.startsWith('demo-')) {
    throw new Error('Emulators locais exigem modo de desenvolvimento e projectId demo-.');
  }
  return true;
}
