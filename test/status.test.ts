import { describe, expect, it } from "vitest";
import { assessDelay } from "../src/domain/delay.ts";
import { currentStatus, type StatusInput } from "../src/domain/status.ts";
import type { NormalizedStatus } from "../src/domain/types.ts";
import { permutations } from "./helpers/permutations.ts";

function ev(status: NormalizedStatus | null, iso: string): StatusInput {
  return { occurredAt: new Date(iso), status, key: `${status}@${iso}` };
}

describe("status a partir do histórico", () => {
  it("entregue que chega antes de um em trânsito antigo continua entregue", () => {
    const arrival = [ev("postado", "2026-10-01T10:00:00Z"), ev("entregue", "2026-10-04T15:00:00Z"), ev("em_transito", "2026-10-02T08:00:00Z")];
    expect(currentStatus(arrival)).toBe("entregue");
  });

  it("postado antigo que chega depois de saiu para entrega não faz o status voltar", () => {
    const arrival = [ev("saiu_para_entrega", "2026-10-04T07:00:00Z"), ev("postado", "2026-10-01T10:00:00Z")];
    expect(currentStatus(arrival)).toBe("saiu_para_entrega");
  });

  it("evento mais novo com progresso menor também não faz o status voltar", () => {
    // Ex.: tentativa de entrega frustrada registrada como "em trânsito"; a volta fica só no histórico.
    const history = [ev("saiu_para_entrega", "2026-10-04T07:00:00Z"), ev("em_transito", "2026-10-04T19:00:00Z")];
    expect(currentStatus(history)).toBe("saiu_para_entrega");
  });

  it("dá o mesmo status em todas as 720 ordens de chegada de um histórico de 6 eventos", () => {
    const history = [
      ev("postado", "2026-10-01T10:00:00Z"),
      ev("em_transito", "2026-10-02T08:00:00Z"),
      ev("excecao", "2026-10-03T09:00:00Z"),
      ev("em_transito", "2026-10-03T18:00:00Z"),
      ev(null, "2026-10-04T06:00:00Z"),
      ev("saiu_para_entrega", "2026-10-04T07:00:00Z"),
    ];
    const now = new Date("2026-10-05T12:00:00Z");
    const all = permutations(history);
    expect(all).toHaveLength(720);

    const statuses = new Set(all.map((p) => currentStatus(p)));
    const delays = new Set(all.map((p) => JSON.stringify(assessDelay(p, 72, now))));
    expect([...statuses]).toEqual(["saiu_para_entrega"]);
    expect(delays.size).toBe(1);
  });

  it("mostra a exceção enquanto ela for o fato mais recente", () => {
    const history = [ev("postado", "2026-10-01T10:00:00Z"), ev("em_transito", "2026-10-02T08:00:00Z"), ev("excecao", "2026-10-03T09:00:00Z")];
    expect(currentStatus(history)).toBe("excecao");
  });

  it("deixa de mostrar a exceção quando chega progresso posterior", () => {
    const history = [ev("em_transito", "2026-10-02T08:00:00Z"), ev("excecao", "2026-10-03T09:00:00Z"), ev("saiu_para_entrega", "2026-10-04T07:00:00Z")];
    expect(currentStatus(history)).toBe("saiu_para_entrega");
  });

  it("exceção antiga que chega depois não derruba um status mais novo", () => {
    const arrival = [ev("postado", "2026-10-01T10:00:00Z"), ev("saiu_para_entrega", "2026-10-04T07:00:00Z"), ev("excecao", "2026-10-02T09:00:00Z")];
    expect(currentStatus(arrival)).toBe("saiu_para_entrega");
  });

  it("depois de entregue, nem exceção posterior muda o status", () => {
    const history = [ev("entregue", "2026-10-04T15:00:00Z"), ev("excecao", "2026-10-05T09:00:00Z")];
    expect(currentStatus(history)).toBe("entregue");
  });

  it("status desconhecido não muda o status atual", () => {
    expect(currentStatus([ev("em_transito", "2026-10-02T08:00:00Z"), ev(null, "2026-10-05T08:00:00Z")])).toBe("em_transito");
  });

  it("só com status desconhecido, não há status", () => {
    expect(currentStatus([ev(null, "2026-10-02T08:00:00Z")])).toBeNull();
    expect(currentStatus([])).toBeNull();
  });
});
