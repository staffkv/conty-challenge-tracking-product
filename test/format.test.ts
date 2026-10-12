import { describe, expect, it } from "vitest";
import { assessDelay } from "../src/domain/delay.ts";
import { brasilia, delaySummary, duration } from "../src/tracking/format.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("textos para quem acompanha a campanha", () => {
  it.each([
    [10 * DAY + 23 * HOUR + 48 * MIN, "10 dias e 23 h"],
    [21 * DAY + 23 * HOUR + 57 * MIN, "21 dias e 23 h"],
    [2 * DAY + 58 * MIN, "2 dias e 58 min"],
    [10 * DAY + 23 * HOUR, "10 dias e 23 h"],
    [7 * DAY, "7 dias"],
    [7 * DAY + MIN, "7 dias e 1 min"],
    [1 * DAY + 2 * HOUR, "1 dia e 2 h"],
    [5 * HOUR + 30 * MIN, "5 h e 30 min"],
    [45 * MIN, "45 min"],
    [30_000, "menos de 1 min"],
  ])("duração de %i ms é %s", (ms, text) => {
    expect(duration(ms)).toBe(text);
  });

  it("datas saem no horário de Brasília", () => {
    expect(brasilia(new Date("2026-10-08T13:02:00Z"))).toBe("08/10/2026 às 10:02");
    expect(brasilia(new Date("2026-10-09T01:30:00Z"))).toBe("08/10/2026 às 22:30");
  });

  it("um minuto além do limite aparece na frase, sem parecer igual ao limite", () => {
    const posted = { occurredAt: new Date("2026-10-01T13:02:00Z"), status: "postado" as const };
    const a = assessDelay([posted], 7, new Date("2026-10-08T13:03:00Z"));
    expect(delaySummary(a)).toBe("Postado há 7 dias e 1 min e ainda sem entrega; passou do limite de 7 dias em 08/10/2026 às 10:02.");
  });

  it("limite de 1 dia fica no singular", () => {
    const a = assessDelay([], 1, new Date("2026-10-08T13:03:00Z"));
    expect(delaySummary(a)).toBe("Ainda sem postagem reconhecida; a contagem do prazo de 1 dia não começou.");
  });
});
