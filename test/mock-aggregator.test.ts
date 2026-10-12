import { describe, expect, it } from "vitest";
import { MockAggregator } from "../mock-aggregator/app.ts";
import { createApp } from "../src/app.ts";
import { RastreioFakeClient } from "../src/providers/rastreio-fake/client.ts";
import { buildService } from "./helpers/harness.ts";

const CODE = "QB123456789BR";

function setup() {
  const mock = new MockAggregator();
  mock.now = () => new Date("2026-10-05T15:00:00Z");
  const provider = new RastreioFakeClient({ baseUrl: "http://agregador.test", fetch: mock.fetch });
  const { service, clock } = buildService({ provider, publish: () => {}, setOffline: () => {} }, { now: "2026-10-01T12:00:00Z" });
  const api = createApp(service);
  const insert = (body: unknown) =>
    mock.app.request(`/trackings/correios/${CODE}/checkpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const register = async () =>
    (await (
      await api.request("/v1/shipments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tracking_code: CODE, carrier: "correios" }),
      })
    ).json()) as { id: string; status: string | null };
  const query = async (id: string) => (await api.request(`/v1/shipments/${id}`)).json();
  return { mock, api, clock, insert, register, query };
}

describe("agregador fictício reiniciado", () => {
  it("cadastrar de novo refaz o cadastro no agregador e volta a sincronizar", async () => {
    let mock = new MockAggregator();
    const provider = new RastreioFakeClient({ baseUrl: "http://agregador.test", fetch: (input, init) => mock.fetch(input, init) });
    const { service } = buildService({ provider, publish: () => {}, setOffline: () => {} });
    const { view } = await service.register({ trackingCode: CODE, carrier: "correios" });

    mock = new MockAggregator(); // reiniciou e perdeu tudo o que estava em memória
    expect(await service.refresh(view.id)).toMatchObject({ stale: true, sync_error: "nao_encontrado" });

    const again = await service.register({ trackingCode: CODE, carrier: "correios" });
    expect(again).toMatchObject({ created: false, view: { id: view.id, stale: false, sync_error: null } });
  });
});

describe("inserir eventos no agregador fictício e consultar na API", () => {
  it("cadastra, recebe eventos aos poucos e consulta o status normalizado", async () => {
    const { clock, insert, register, query } = setup();
    const { id, status } = await register();
    expect(status).toBeNull();

    expect((await insert({ courier_status: "PO", checkpoint_time: "2026-10-01 10:00:00" })).status).toBe(201);
    clock.set("2026-10-02T12:00:00Z");
    expect(await query(id)).toMatchObject({ status: "postado", posted_at: "2026-10-01T13:00:00Z" });

    await insert([
      { courier_status: "OEC", checkpoint_time: "2026-10-02 08:00:00", message: "Saiu para entrega" },
      { courier_status: "RO", checkpoint_time: "2026-10-01 20:00:00" }, // antigo, chega depois
      { courier_status: "ENTREGA-PREVISTA", checkpoint_time: "2026-10-02 09:00:00" }, // inventado
    ]);
    const view = await query(id);
    expect(view).toMatchObject({ status: "saiu_para_entrega", unmapped_events: 1 });
    expect(view.history.map((h: { raw_status: string }) => h.raw_status)).toEqual(["PO", "RO", "OEC", "ENTREGA-PREVISTA"]);

    await insert({ courier_status: "BDE", checkpoint_time: "2026-10-02 11:00:00" });
    expect(await query(id)).toMatchObject({ status: "entregue", delay: { late: false } });
  });

  it("sem horário, o evento ganha o horário atual do agregador em Brasília", async () => {
    const { insert, register } = setup();
    await register();
    const res = await insert({ courier_status: "PO" });
    expect((await res.json()).data.added[0]).toMatchObject({
      checkpoint_time: "2026-10-05 12:00:00",
      checkpoint_tz: "-03:00",
      message: "PO",
    });
  });

  it("recusa evento para código não cadastrado e evento sem courier_status", async () => {
    const { insert, register } = setup();
    expect((await insert({ courier_status: "PO" })).status).toBe(404);
    await register();
    expect((await insert({ message: "sem status" })).status).toBe(400);
    expect((await insert([{ courier_status: "PO" }, {}])).status).toBe(400);
  });
});
