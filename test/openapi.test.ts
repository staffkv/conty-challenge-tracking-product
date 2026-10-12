import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openApiDocument } from "../src/openapi.ts";
import { InMemoryProvider } from "../src/providers/in-memory.ts";
import { buildService, type ProviderHarness } from "./helpers/harness.ts";

type Schema = { $ref?: string; type?: string | readonly string[]; properties?: Record<string, Schema>; required?: readonly string[]; items?: Schema };

const doc = openApiDocument as unknown as {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: Schema; example?: unknown }> }> }>>;
  components: { schemas: Record<string, Schema> };
};

function resolve(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  const target = doc.components.schemas[name];
  if (!target) throw new Error(`Esquema inexistente: ${schema.$ref}`);
  return resolve(target);
}

/** Lista as diferenças entre um valor e o esquema: campo faltando, campo não documentado. */
function mismatches(value: unknown, schema: Schema, path = "$"): string[] {
  const s = resolve(schema);
  if (Array.isArray(value)) return s.items ? value.flatMap((v, i) => mismatches(v, s.items!, `${path}[${i}]`)) : [];
  if (value === null || typeof value !== "object" || !s.properties) return [];
  const keys = Object.keys(value);
  const documented = Object.keys(s.properties);
  return [
    ...keys.filter((k) => !documented.includes(k)).map((k) => `${path}.${k} não está documentado`),
    ...(s.required ?? []).filter((k) => !keys.includes(k)).map((k) => `${path}.${k} é obrigatório e não veio`),
    ...keys.flatMap((k) => (s.properties![k] ? mismatches((value as Record<string, unknown>)[k], s.properties![k]!, `${path}.${k}`) : [])),
  ];
}

function responseSchema(path: string, method: string, status: string): Schema {
  const schema = doc.paths[path]?.[method]?.responses[status]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`Sem esquema para ${method.toUpperCase()} ${path} ${status}`);
  return schema;
}

async function setup() {
  const provider = new InMemoryProvider();
  const harness: ProviderHarness = { provider, publish: () => {}, setOffline: () => {} };
  const { service, clock } = buildService(harness, { now: "2026-10-01T00:00:00Z" });
  return { app: createApp(service), provider, clock };
}

describe("documentação OpenAPI", () => {
  it("documenta exatamente as rotas da API", async () => {
    const { app } = await setup();
    const implemented = new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && !["/openapi.json", "/docs"].includes(r.path))
        .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
    );
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([path, methods]) => Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`)),
    );
    expect([...documented].sort()).toEqual([...implemented].sort());
  });

  it("os campos das respostas reais batem com os esquemas", async () => {
    const { app, provider, clock } = await setup();
    const created = await app.request("/v1/shipments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracking_code: "QB123456789BR", carrier: "correios", reference: "campanha-42" }),
    });
    const { id } = (await created.json()) as { id: string };
    provider.publish("QB123456789BR", "correios", [
      { occurredAt: new Date("2026-10-01T13:00:00Z"), status: "postado", rawStatus: "PO", description: "Objeto postado", location: "SP" },
      { occurredAt: new Date("2026-10-02T13:00:00Z"), status: null, rawStatus: "RX9", description: "?", location: null },
    ]);
    clock.set("2026-10-20T00:00:00Z"); // passa do limite: a resposta traz alerta e late_since preenchidos

    const responses: Array<[string, string, string, Response]> = [
      ["/health", "get", "200", await app.request("/health")],
      ["/v1/shipments/{id}", "get", "200", await app.request(`/v1/shipments/${id}`)],
      ["/v1/alerts", "get", "200", await app.request("/v1/alerts")],
      ["/v1/shipments/{id}", "get", "404", await app.request("/v1/shipments/nao-existe")],
      [
        "/v1/shipments",
        "post",
        "400",
        await app.request("/v1/shipments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      ],
    ];
    for (const [path, method, status, res] of responses) {
      expect(String(res.status)).toBe(status);
      const body = await res.json();
      expect(mismatches(body, responseSchema(path, method, status)), `${method.toUpperCase()} ${path} ${status}`).toEqual([]);
    }
  });

  it("os exemplos da documentação seguem os próprios esquemas", () => {
    const problems = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods).flatMap(([method, op]) =>
        Object.entries(op.responses).flatMap(([status, response]) => {
          const media = response.content?.["application/json"];
          return media?.example === undefined ? [] : mismatches(media.example, media.schema, `${method} ${path} ${status}`);
        }),
      ),
    );
    expect(problems).toEqual([]);
  });

  it("serve a especificação e a página do Scalar", async () => {
    const { app } = await setup();
    const spec = await app.request("/openapi.json");
    expect(spec.status).toBe(200);
    expect((await spec.json()).openapi).toBe("3.1.0");
    const docs = await app.request("/docs");
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain("/openapi.json");
  });
});
