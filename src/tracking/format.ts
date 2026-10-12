import type { DelayAssessment } from "../domain/delay.ts";

export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const MINUTE_MS = 60_000;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
}

/**
 * Duração para pessoas: "10 dias e 23 h", "5 h e 30 min", "45 min".
 * A partir de 1 dia, os minutos só aparecem quando não há horas, para que
 * "7 dias e 1 min" não pareça igual ao limite de "7 dias".
 */
export function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days > 0 ? plural(days, "dia", "dias") : null,
    hours > 0 ? `${hours} h` : null,
    minutes > 0 && (days === 0 || hours === 0) ? `${minutes} min` : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? "menos de 1 min" : joinParts(parts);
}

export function days(n: number): string {
  return plural(n, "dia", "dias");
}

/** Dias com uma casa decimal, para a resposta da API. */
export function toDays(ms: number): number {
  return Math.round((ms / 86_400_000) * 10) / 10;
}

const BRASILIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "08/10/2026 às 10:02", no horário de Brasília. */
export function brasilia(date: Date): string {
  const p = Object.fromEntries(BRASILIA.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

/** Frase pronta para quem acompanha a campanha. */
export function delaySummary(a: DelayAssessment): string {
  const limit = days(a.limitDays);
  if (a.startedAt === null || a.elapsedMs === null) {
    return `Ainda sem postagem reconhecida; a contagem do prazo de ${limit} não começou.`;
  }
  const elapsed = duration(a.elapsedMs);
  if (a.deliveredAt) {
    return a.late
      ? `Entregue em ${elapsed}, acima do limite de ${limit}.`
      : `Entregue em ${elapsed}, dentro do limite de ${limit}.`;
  }
  return a.late && a.lateSince
    ? `Postado há ${elapsed} e ainda sem entrega; passou do limite de ${limit} em ${brasilia(a.lateSince)}.`
    : `Postado há ${elapsed}; o limite é de ${limit}.`;
}
