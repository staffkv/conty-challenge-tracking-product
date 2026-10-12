import { Scalar } from "@scalar/hono-api-reference";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ProviderError } from "./domain/types.ts";
import { openApiDocument } from "./openapi.ts";
import { lookupSchema, registerSchema } from "./schema.ts";
import { UnsupportedCarrierError, type TrackingService } from "./tracking/service.ts";

function fail(c: Context, status: ContentfulStatusCode, code: string, message: string, field?: string) {
  return c.json({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

export function createApp(service: TrackingService): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/openapi.json", (c) => c.json(openApiDocument));
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "Rastreio do produto físico" }));

  app.post(
    "/v1/shipments",
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => fail(c, 413, "payload_grande_demais", "O corpo passa de 16 KiB.") }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail(c, 400, "json_invalido", "O corpo não é um JSON válido.");
      }
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const field = issue.code === "unrecognized_keys" ? issue.keys.join(", ") : issue.path.join(".") || undefined;
        const message = issue.code === "unrecognized_keys" ? "Campo não aceito." : issue.message;
        return fail(c, 400, "payload_invalido", message, field);
      }

      try {
        const { created, view } = await service.register({
          trackingCode: parsed.data.tracking_code,
          carrier: parsed.data.carrier,
          transitLimitDays: parsed.data.transit_limit_days,
          reference: parsed.data.reference,
        });
        return c.json(view, created ? 201 : 200);
      } catch (error) {
        if (error instanceof UnsupportedCarrierError) {
          return fail(c, 422, "transportadora_nao_suportada", error.message, "carrier");
        }
        if (error instanceof ProviderError) {
          return fail(c, 502, `agregador_${error.kind}`, `Não foi possível cadastrar no agregador: ${error.message}`);
        }
        throw error;
      }
    },
  );

  app.get("/v1/shipments", async (c) => {
    const parsed = lookupSchema.safeParse(c.req.query());
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const field = issue.code === "unrecognized_keys" ? issue.keys.join(", ") : issue.path.join(".") || undefined;
      return fail(c, 400, "consulta_invalida", issue.code === "unrecognized_keys" ? "Parâmetro não aceito." : issue.message, field);
    }
    const shipments = await service.findByCode(parsed.data.tracking_code, parsed.data.carrier);
    return c.json({ shipments });
  });

  app.get("/v1/shipments/:id", async (c) => {
    const id = c.req.param("id");
    const view = await service.refresh(id);
    if (!view) {
      const hint = id.startsWith("shp_")
        ? "Não há encomenda com esse id."
        : `Não há encomenda com esse id. Esta rota usa o id devolvido no cadastro (shp_...); para buscar pelo código de rastreio, use GET /v1/shipments?tracking_code=${encodeURIComponent(id)}.`;
      return fail(c, 404, "encomenda_nao_encontrada", hint);
    }
    return c.json(view);
  });

  app.get("/v1/alerts", (c) => c.json({ alerts: service.listAlerts() }));

  app.notFound((c) => fail(c, 404, "rota_nao_encontrada", "Rota não encontrada."));

  return app;
}
