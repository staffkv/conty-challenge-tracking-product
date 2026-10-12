import { Hono } from "hono";

// Agregador de rastreio fictício. Fala o próprio formato, como um serviço externo.

export type MockCheckpoint = {
  checkpoint_id: string;
  checkpoint_time: string;
  checkpoint_tz?: string | null;
  courier_status: string;
  message: string;
  location?: string | null;
};

const COURIERS = new Set(["correios", "jadlog", "loggi"]);

export class MockAggregator {
  readonly app = new Hono();
  private readonly trackings = new Map<string, unknown[]>();
  private readonly failures = new Map<string, number[]>();
  private delayMs = 0;
  private offline = false;
  /** Chamada a cada cadastro novo; a demonstração usa para carregar cenários. */
  onRegister: (courier: string, number: string) => unknown[] = () => [];

  constructor() {
    this.app.use("*", async (c, next) => {
      if (this.offline) return c.json({ error: { code: "service_unavailable" } }, 503);
      await next();
    });

    this.app.post("/trackings", async (c) => {
      const body = (await c.req.json().catch(() => null)) as { tracking_number?: unknown; courier_code?: unknown } | null;
      const number = typeof body?.tracking_number === "string" ? body.tracking_number : null;
      const courier = typeof body?.courier_code === "string" ? body.courier_code : null;
      if (!number || !courier) return c.json({ error: { code: "invalid_request" } }, 400);
      if (!COURIERS.has(courier)) return c.json({ error: { code: "courier_not_supported" } }, 422);
      const failure = this.nextFailure(courier, number);
      if (failure) return c.json({ error: { code: "upstream_error" } }, failure as 500);
      const key = `${courier}:${number}`;
      if (this.trackings.has(key)) return c.json({ data: { tracking_number: number, courier_code: courier } }, 200);
      this.trackings.set(key, this.onRegister(courier, number));
      return c.json({ data: { tracking_number: number, courier_code: courier } }, 201);
    });

    this.app.get("/trackings/:courier/:number", async (c) => {
      const { courier, number } = c.req.param();
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      const failure = this.nextFailure(courier, number);
      if (failure) return c.json({ error: { code: "upstream_error" } }, failure as 500);
      const checkpoints = this.trackings.get(`${courier}:${number}`);
      if (!checkpoints) return c.json({ error: { code: "tracking_not_found" } }, 404);
      return c.json({ data: { tracking_number: number, courier_code: courier, checkpoints } });
    });
  }

  /** Acrescenta checkpoints na ordem dada (pode ser fora de ordem ou repetida). */
  push(courier: string, number: string, ...checkpoints: unknown[]): void {
    const key = `${courier}:${number}`;
    this.trackings.set(key, [...(this.trackings.get(key) ?? []), ...checkpoints]);
  }

  /** As próximas respostas para este código saem com estes status HTTP. */
  failNext(courier: string, number: string, ...statuses: number[]): void {
    this.failures.set(`${courier}:${number}`, statuses);
  }

  /** Todas as respostas saem com 503 enquanto estiver fora do ar. */
  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  /** fetch que entrega a requisição direto ao app, sem abrir porta. */
  readonly fetch: typeof fetch = async (input, init) => this.app.fetch(new Request(input, init));

  private nextFailure(courier: string, number: string): number | undefined {
    return this.failures.get(`${courier}:${number}`)?.shift();
  }
}
