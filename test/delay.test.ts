import { describe, expect, it } from "vitest";
import { assessDelay, type DelayAssessment, type DelayInput } from "../src/domain/delay.ts";
import type { NormalizedStatus } from "../src/domain/types.ts";

function ev(status: NormalizedStatus | null, iso: string): DelayInput {
  return { occurredAt: new Date(iso), status };
}

const posted = ev("postado", "2026-10-01T12:00:00Z");
const LIMIT = 3; // dias

function hoursOf(a: DelayAssessment): number | null {
  return a.elapsedMs === null ? null : a.elapsedMs / 3_600_000;
}

describe("regra de atraso com data controlada", () => {
  it("exatamente no limite ainda não é atraso", () => {
    const a = assessDelay([posted], LIMIT, new Date("2026-10-04T12:00:00Z"));
    expect(a.late).toBe(false);
    expect(hoursOf(a)).toBe(72);
  });

  it("um minuto depois do limite é atraso, desde o instante em que o limite passou", () => {
    const a = assessDelay([posted], LIMIT, new Date("2026-10-04T12:01:00Z"));
    expect(a.late).toBe(true);
    expect(a.deliveredLate).toBe(false);
    expect(a.lateSince?.toISOString()).toBe("2026-10-04T12:00:00.000Z");
  });

  it("entregue dentro do limite e consultado 30 dias depois não é atraso", () => {
    const history = [posted, ev("entregue", "2026-10-03T18:00:00Z")];
    const a = assessDelay(history, LIMIT, new Date("2026-11-02T12:00:00Z"));
    expect(a.late).toBe(false);
    expect(hoursOf(a)).toBe(54);
    expect(a.deliveredAt?.toISOString()).toBe("2026-10-03T18:00:00.000Z");
  });

  it("entregue depois do limite fica marcado como entregue com atraso", () => {
    const history = [posted, ev("entregue", "2026-10-05T09:00:00Z")];
    const a = assessDelay(history, LIMIT, new Date("2026-10-06T12:00:00Z"));
    expect(a.late).toBe(true);
    expect(a.deliveredLate).toBe(true);
    expect(hoursOf(a)).toBe(93);
  });

  it("a contagem começa na postagem, não no cadastro", () => {
    // Cadastrado em 20/09, postado só em 01/10: os 11 dias de espera não contam.
    const a = assessDelay([posted], LIMIT, new Date("2026-10-02T12:00:00Z"));
    expect(hoursOf(a)).toBe(24);
    expect(a.late).toBe(false);
  });

  it("sem postagem, começa no primeiro em trânsito", () => {
    const a = assessDelay([ev("em_transito", "2026-10-02T12:00:00Z")], LIMIT, new Date("2026-10-04T12:00:00Z"));
    expect(a.startedAt?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(hoursOf(a)).toBe(48);
  });

  it("sem evento de início não há atraso, e o motivo explica", () => {
    const a = assessDelay([ev(null, "2026-09-01T00:00:00Z"), ev("excecao", "2026-09-02T00:00:00Z")], LIMIT, new Date("2026-12-01T00:00:00Z"));
    expect(a.late).toBe(false);
    expect(hoursOf(a)).toBeNull();
  });

  it("exceção não para o relógio", () => {
    const a = assessDelay([posted, ev("excecao", "2026-10-02T12:00:00Z")], LIMIT, new Date("2026-10-05T12:00:00Z"));
    expect(a.late).toBe(true);
  });

  it("status desconhecido não inicia a contagem", () => {
    const a = assessDelay([ev(null, "2026-09-01T00:00:00Z"), posted], LIMIT, new Date("2026-10-02T12:00:00Z"));
    expect(a.startedAt?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });
});
