import { beforeEach, describe, expect, it } from "vitest";
import { MockAggregator } from "../mock-aggregator/app.ts";
import { ProviderError } from "../src/domain/types.ts";
import { RastreioFakeClient } from "../src/providers/rastreio-fake/client.ts";

const CODE = "QB123456789BR";
let mock: MockAggregator;
let client: RastreioFakeClient;

beforeEach(() => {
  mock = new MockAggregator();
  client = new RastreioFakeClient({ baseUrl: "http://agregador.test", fetch: mock.fetch, timeoutMs: 50 });
});

async function errorKind(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error.kind;
    throw error;
  }
  throw new Error("era esperado um ProviderError");
}

function fetchReturning(status: number, body: string): typeof fetch {
  return async () => new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("cliente HTTP do agregador", () => {
  it("cadastra e devolve eventos no formato do domínio", async () => {
    await client.register(CODE, "correios");
    mock.push("correios", CODE, {
      checkpoint_id: "cp_1",
      checkpoint_time: "2026-10-01 10:02:00",
      checkpoint_tz: "-03:00",
      courier_status: "PO",
      message: "Objeto postado",
      location: "AGF Pinheiros - SP",
    });
    expect(await client.fetchEvents(CODE, "correios")).toEqual([
      {
        occurredAt: new Date("2026-10-01T13:02:00Z"),
        status: "postado",
        rawStatus: "PO",
        description: "Objeto postado",
        location: "AGF Pinheiros - SP",
      },
    ]);
  });

  it("cadastro repetido no agregador não é erro", async () => {
    await client.register(CODE, "correios");
    await expect(client.register(CODE, "correios")).resolves.toBeUndefined();
  });

  it("código que o agregador não conhece vira nao_encontrado", async () => {
    expect(await errorKind(client.fetchEvents(CODE, "correios"))).toBe("nao_encontrado");
  });

  it("tenta de novo uma vez na consulta quando o agregador falha com 5xx", async () => {
    await client.register(CODE, "correios");
    mock.failNext("correios", CODE, 503);
    await expect(client.fetchEvents(CODE, "correios")).resolves.toEqual([]);
  });

  it("duas falhas 5xx seguidas viram indisponivel", async () => {
    await client.register(CODE, "correios");
    mock.failNext("correios", CODE, 500, 502);
    expect(await errorKind(client.fetchEvents(CODE, "correios"))).toBe("indisponivel");
  });

  it("agregador lento vira indisponivel depois do timeout", async () => {
    await client.register(CODE, "correios");
    mock.setDelay(200);
    expect(await errorKind(client.fetchEvents(CODE, "correios"))).toBe("indisponivel");
  });

  it("falha de rede vira indisponivel", async () => {
    const offline = new RastreioFakeClient({
      baseUrl: "http://agregador.test",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await errorKind(offline.fetchEvents(CODE, "correios"))).toBe("indisponivel");
  });

  it("JSON inválido vira resposta_invalida", async () => {
    const broken = new RastreioFakeClient({ baseUrl: "http://x", fetch: fetchReturning(200, "{nao é json") });
    expect(await errorKind(broken.fetchEvents(CODE, "correios"))).toBe("resposta_invalida");
  });

  it("payload fora do formato vira resposta_invalida", async () => {
    const broken = new RastreioFakeClient({ baseUrl: "http://x", fetch: fetchReturning(200, JSON.stringify({ items: [] })) });
    expect(await errorKind(broken.fetchEvents(CODE, "correios"))).toBe("resposta_invalida");
  });

  it("resposta sobre outro código vira resposta_invalida", async () => {
    const body = JSON.stringify({ data: { tracking_number: "OUTRO", courier_code: "correios", checkpoints: [] } });
    const broken = new RastreioFakeClient({ baseUrl: "http://x", fetch: fetchReturning(200, body) });
    expect(await errorKind(broken.fetchEvents(CODE, "correios"))).toBe("resposta_invalida");
  });

  it("descarta checkpoint com data ilegível, registra no log e mantém os outros", async () => {
    const logged: Record<string, unknown>[] = [];
    const logging = new RastreioFakeClient({ baseUrl: "http://x", fetch: mock.fetch, log: (e) => logged.push(e) });
    await logging.register(CODE, "correios");
    mock.push(
      "correios",
      CODE,
      { checkpoint_id: "a", checkpoint_time: "32/13/2026", courier_status: "RO", message: "x" },
      { checkpoint_id: "b", checkpoint_time: "2026-10-02 08:40:00", courier_status: "RO", message: "y" },
    );
    const events = await logging.fetchEvents(CODE, "correios");
    expect(events.map((e) => e.description)).toEqual(["y"]);
    expect(logged).toEqual([{ event: "checkpoints_descartados", carrier: "correios", tracking_code: CODE, count: 1 }]);
  });

  it("transportadora recusada pelo agregador no cadastro vira rejeitado", async () => {
    expect(await errorKind(client.register(CODE, "transportadora-x"))).toBe("rejeitado");
  });

  it("conhece só as transportadoras que sabe traduzir", () => {
    expect(client.supportsCarrier("correios")).toBe(true);
    expect(client.supportsCarrier("transportadora-x")).toBe(false);
    expect(client.supportsCarrier("toString")).toBe(false);
  });
});
