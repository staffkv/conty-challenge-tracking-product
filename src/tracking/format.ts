export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function hours(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
}
