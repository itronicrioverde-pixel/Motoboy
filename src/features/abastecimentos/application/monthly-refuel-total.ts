export interface DatedRefuelAmount {
  readonly dateISO?: string | null;
  readonly valor: number;
}

/** Soma somente abastecimentos atribuíveis ao mês ISO solicitado. */
export function monthlyRefuelTotal(
  refuels: readonly DatedRefuelAmount[],
  monthKey: string,
): number {
  return refuels.reduce((total, refuel) => {
    if (refuel.dateISO?.slice(0, 7) !== monthKey) return total;
    return total + (Number.isFinite(refuel.valor) ? refuel.valor : 0);
  }, 0);
}
