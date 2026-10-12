import type { NormalizedStatus } from "./types.ts";

export type DelayInput = {
  occurredAt: Date;
  status: NormalizedStatus | null;
};

export type DelayAssessment = {
  late: boolean;
  deliveredLate: boolean;
  limitHours: number;
  /** Horas de trânsito, ou null se o pacote ainda não tem evento de início. */
  elapsedHours: number | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  /** Instante em que o limite foi ultrapassado, só quando há atraso. */
  lateSince: Date | null;
  reason: string | null;
};

const HOUR_MS = 3_600_000;

function earliest(events: readonly DelayInput[]): Date | null {
  let min: Date | null = null;
  for (const e of events) {
    if (min === null || e.occurredAt.getTime() < min.getTime()) min = e.occurredAt;
  }
  return min;
}

/**
 * Atraso = tempo em trânsito estritamente maior que o limite.
 * - Começa no primeiro evento de progresso (postagem, ou o primeiro em trânsito
 *   se a transportadora pular a postagem), nunca na data de cadastro.
 * - Termina no horário da entrega informado pela transportadora; sem entrega,
 *   em `now`. Por isso, pacote entregue no prazo não vira atraso ao ser
 *   consultado depois.
 * - Exceção não para o relógio. Status desconhecido não conta.
 */
export function assessDelay(events: readonly DelayInput[], limitHours: number, now: Date): DelayAssessment {
  const progress = events.filter((e) => e.status !== null && e.status !== "excecao");
  const startedAt = earliest(progress);
  const deliveredAt = earliest(progress.filter((e) => e.status === "entregue"));

  if (startedAt === null) {
    return {
      late: false,
      deliveredLate: false,
      limitHours,
      elapsedHours: null,
      startedAt: null,
      deliveredAt: null,
      lateSince: null,
      reason: "O pacote ainda não tem evento de postagem reconhecido; a contagem do trânsito não começou.",
    };
  }

  const end = deliveredAt ?? now;
  const elapsedMs = Math.max(0, end.getTime() - startedAt.getTime());
  const late = elapsedMs > limitHours * HOUR_MS;

  return {
    late,
    deliveredLate: late && deliveredAt !== null,
    limitHours,
    elapsedHours: Math.round((elapsedMs / HOUR_MS) * 10) / 10,
    startedAt,
    deliveredAt,
    lateSince: late ? new Date(startedAt.getTime() + limitHours * HOUR_MS) : null,
    reason: null,
  };
}
