export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function hours(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
}

/** Duração para texto: "52 h", "72 h e 1 min". */
export function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  return min === 0 ? `${h} h` : `${h} h e ${min} min`;
}
