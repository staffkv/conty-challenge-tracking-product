import { describe, expect, it } from "vitest";
import { STATUS_MAPS, translateStatus } from "../src/providers/rastreio-fake/status-map.ts";
import { checkpointsToEvents, parseCheckpointTime } from "../src/providers/rastreio-fake/to-domain.ts";

describe("tradução dos status das transportadoras", () => {
  it.each([
    ["correios", "PO", "postado"],
    ["correios", "RO", "em_transito"],
    ["correios", "DO", "em_transito"],
    ["correios", "OEC", "saiu_para_entrega"],
    ["correios", "BDE", "entregue"],
    ["correios", "BDI-ausente", "excecao"],
    ["correios", "BDE-remetente", "excecao"],
    ["correios", "FC-extravio", "excecao"],
    ["jadlog", "EMISSAO", "postado"],
    ["jadlog", "Transferência", "em_transito"],
    ["jadlog", "EM  ROTA", "saiu_para_entrega"],
    ["jadlog", "ENTREGUE", "entregue"],
    ["jadlog", "INSUCESSO", "excecao"],
    ["jadlog", "DEVOLVIDO", "excecao"],
    ["loggi", "picked_up", "postado"],
    ["loggi", "in_transit", "em_transito"],
    ["loggi", "out_for_delivery", "saiu_para_entrega"],
    ["loggi", "delivered", "entregue"],
    ["loggi", "delivery_failed", "excecao"],
    ["loggi", "returned_to_sender", "excecao"],
  ])("%s %s → %s", (carrier, code, expected) => {
    expect(translateStatus(carrier, code)).toBe(expected);
  });

  it("só estes códigos levam a entregue; acrescentar outro exige mudar este teste de propósito", () => {
    const delivered = Object.entries(STATUS_MAPS).flatMap(([carrier, table]) =>
      Object.entries(table)
        .filter(([, status]) => status === "entregue")
        .map(([code]) => `${carrier}:${code}`),
    );
    expect(delivered.sort()).toEqual(["correios:BDE", "jadlog:ENTREGUE", "loggi:DELIVERED"]);
  });

  it.each([
    ["correios", "RX9"],
    ["correios", "BDE-PENDENTE"],
    ["jadlog", "ENTREGA AGENDADA"],
    ["jadlog", "ENTREGUE?"],
    ["loggi", "delivered_pending_locker"],
    ["loggi", "pre_delivered"],
    ["correios", ""],
  ])("status inventado %s %j não vira status nenhum, muito menos entregue", (carrier, code) => {
    expect(translateStatus(carrier, code)).toBeNull();
  });

  it("transportadora desconhecida não tem tradução", () => {
    expect(translateStatus("transportadora-x", "DELIVERED")).toBeNull();
  });

  it("a mensagem do checkpoint não decide o status", () => {
    const { events } = checkpointsToEvents("correios", [
      { checkpoint_id: "a", checkpoint_time: "2026-10-05 16:00:00", courier_status: "XYZ", message: "Objeto entregue ao destinatário" },
    ]);
    expect(events[0]?.status).toBeNull();
    expect(events[0]?.rawStatus).toBe("XYZ");
  });
});

describe("horário dos checkpoints", () => {
  it("horário sem fuso é horário de Brasília", () => {
    expect(parseCheckpointTime("2026-10-02 08:40:00", null)?.toISOString()).toBe("2026-10-02T11:40:00.000Z");
  });

  it("respeita o fuso informado no checkpoint e o fuso embutido no horário", () => {
    expect(parseCheckpointTime("2026-10-02 08:40", "-04:00")?.toISOString()).toBe("2026-10-02T12:40:00.000Z");
    expect(parseCheckpointTime("2026-10-02T11:40:00Z", "-03:00")?.toISOString()).toBe("2026-10-02T11:40:00.000Z");
  });

  it("mesmo instante em fusos diferentes vira o mesmo instante", () => {
    const a = parseCheckpointTime("2026-10-02 08:40:00", "-03:00");
    const b = parseCheckpointTime("2026-10-02T11:40:00Z", null);
    expect(a?.getTime()).toBe(b?.getTime());
  });

  it("descarta checkpoint com horário ilegível ou campo faltando, sem perder os outros", () => {
    const { events, discarded } = checkpointsToEvents("correios", [
      { checkpoint_id: "a", checkpoint_time: "ontem às 10h", courier_status: "RO", message: "x" },
      { checkpoint_id: "b", checkpoint_time: "2026-10-02 08:40:00", courier_status: "RO", message: "x", checkpoint_tz: "Brasília" },
      { checkpoint_id: "c", courier_status: "RO", message: "x" },
      { checkpoint_id: "d", checkpoint_time: "2026-10-02 08:40:00", courier_status: "RO", message: "ok" },
    ]);
    expect(events.map((e) => e.description)).toEqual(["ok"]);
    expect(discarded).toHaveLength(3);
  });
});
