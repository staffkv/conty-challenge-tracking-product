import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.ts";
import { InMemoryProvider } from "../src/providers/in-memory.ts";
import { buildService, type ProviderHarness } from "./helpers/harness.ts";

const CODE = "QB123456789BR";
let provider: InMemoryProvider;
let app: Hono;

beforeEach(() => {
  provider = new InMemoryProvider();
  const harness: ProviderHarness = { provider, publish: () => {}, setOffline: () => {} };
  app = createApp(buildService(harness, { now: "2026-10-03T12:00:00Z" }).service);
});

function post(body: unknown, raw?: string) {
  return app.request("/v1/shipments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("API", () => {
  it("responde à checagem de saúde", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("cadastra com 201 e devolve a mesma encomenda com 200 na repetição", async () => {
    const first = await post({ tracking_code: "qb123456789br", carrier: "Correios", transit_limit_days: 5, reference: "campanha-42" });
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ tracking_code: CODE, carrier: "correios", reference: "campanha-42", status: null });
    expect(created.delay.limit_days).toBe(5);

    const again = await post({ tracking_code: CODE, carrier: "correios" });
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(created.id);
  });

  it("consulta devolve status normalizado e histórico", async () => {
    const { id } = await (await post({ tracking_code: CODE, carrier: "correios" })).json();
    provider.publish(CODE, "correios", [
      { occurredAt: new Date("2026-10-01T13:00:00Z"), status: "postado", rawStatus: "PO", description: "Objeto postado", location: null },
      { occurredAt: new Date("2026-10-02T13:00:00Z"), status: null, rawStatus: "RX9", description: "?", location: null },
    ]);
    const res = await app.request(`/v1/shipments/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "postado",
      posted_at: "2026-10-01T13:00:00Z",
      unmapped_events: 1,
      delay: { late: false, elapsed_days: 2, limit_days: 3, summary: "Postado há 1 dia e 23 h; o limite é de 3 dias." },
      stale: false,
    });
  });

  it.each([
    ["JSON malformado", undefined, "{", "json_invalido", undefined],
    ["código curto", { tracking_code: "AB1", carrier: "correios" }, undefined, "payload_invalido", "tracking_code"],
    ["código com espaço", { tracking_code: "QB 123456789BR", carrier: "correios" }, undefined, "payload_invalido", "tracking_code"],
    ["sem transportadora", { tracking_code: CODE }, undefined, "payload_invalido", "carrier"],
    ["limite fracionado", { tracking_code: CODE, carrier: "correios", transit_limit_days: 1.5 }, undefined, "payload_invalido", "transit_limit_days"],
    ["limite zero", { tracking_code: CODE, carrier: "correios", transit_limit_days: 0 }, undefined, "payload_invalido", "transit_limit_days"],
    ["campo extra", { tracking_code: CODE, carrier: "correios", status: "entregue" }, undefined, "payload_invalido", "status"],
  ])("recusa %s com 400 e nome do campo", async (_case, body, raw, code, field) => {
    const res = await post(body, raw);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe(code);
    expect(json.error.field).toBe(field);
  });

  it("recusa corpo grande demais com 413", async () => {
    const res = await post({ tracking_code: CODE, carrier: "correios", reference: "x".repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it("recusa transportadora não suportada com 422", async () => {
    const res = await post({ tracking_code: CODE, carrier: "transportadora-x" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "transportadora_nao_suportada", field: "carrier" });
  });

  it("agregador fora do ar no cadastro dá 502 e não grava nada", async () => {
    provider.failWith("indisponivel");
    const res = await post({ tracking_code: CODE, carrier: "correios" });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("agregador_indisponivel");
    provider.failWith(null);
    expect((await post({ tracking_code: CODE, carrier: "correios" })).status).toBe(201);
  });

  it("agregador fora do ar na consulta devolve 200 com stale", async () => {
    const { id } = await (await post({ tracking_code: CODE, carrier: "correios" })).json();
    provider.failWith("indisponivel");
    const res = await app.request(`/v1/shipments/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stale: true, sync_error: "indisponivel" });
  });

  it("encomenda inexistente dá 404", async () => {
    expect((await app.request("/v1/shipments/shp_nao_existe")).status).toBe(404);
  });

  it("consultar pelo código de rastreio na rota do id dá 404 explicando qual rota usar", async () => {
    const res = await app.request(`/v1/shipments/${CODE}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toContain(`GET /v1/shipments?tracking_code=${CODE}`);
  });

  it("busca pelo código de rastreio, em qualquer caixa, com ou sem transportadora", async () => {
    const { id } = await (await post({ tracking_code: CODE, carrier: "correios" })).json();
    const found = await (await app.request(`/v1/shipments?tracking_code=${CODE.toLowerCase()}`)).json();
    expect(found.shipments.map((s: { id: string }) => s.id)).toEqual([id]);
    const byCarrier = await (await app.request(`/v1/shipments?tracking_code=${CODE}&carrier=jadlog`)).json();
    expect(byCarrier).toEqual({ shipments: [] });
  });

  it("busca sem código ou com parâmetro desconhecido dá 400", async () => {
    expect((await app.request("/v1/shipments")).status).toBe(400);
    const res = await app.request(`/v1/shipments?tracking_code=${CODE}&codigo=1`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.field).toBe("codigo");
  });

  it("lista alertas", async () => {
    const res = await app.request("/v1/alerts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alerts: [] });
  });
});
