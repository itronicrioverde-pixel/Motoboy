export interface CurrentPeriodLabel {
  readonly monthYear: string;
  readonly week: string;
}

/** Rótulo curto do cabeçalho, calculado na data local do dispositivo. */
export function currentPeriodLabel(today: Date): CurrentPeriodLabel {
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const weekOfMonth = Math.ceil((today.getDate() + mondayOffset) / 7);
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
    .format(today)
    .replace('.', '')
    .toUpperCase();
  return {
    monthYear: `${monthLabel} ${year}`,
    week: `semana ${weekOfMonth}`,
  };
}
