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
  private manualSeq = 0;
  /** Relógio do agregador; só é usado para preencher o horário de eventos inseridos sem horário. */
  now: () => Date = () => new Date();
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

    // Simula a transportadora atualizando o rastreio. Aceita um checkpoint ou uma lista.
    // Só courier_status é obrigatório; o resto ganha valor padrão. O horário não é
    // validado aqui, para dar para testar como o serviço lida com horário ilegível.
    this.app.post("/trackings/:courier/:number/checkpoints", async (c) => {
      const { courier, number } = c.req.param();
      const key = `${courier}:${number}`;
      if (!this.trackings.has(key)) {
        return c.json({ error: { code: "tracking_not_found", message: "Cadastre o código antes (POST /v1/shipments na API)." } }, 404);
      }
      const body = await c.req.json().catch(() => undefined);
      const items: unknown[] = Array.isArray(body) ? body : [body];
      const checkpoints: MockCheckpoint[] = [];
      for (const item of items) {
        const cp = item as Partial<MockCheckpoint> | null | undefined;
        if (typeof cp?.courier_status !== "string" || cp.courier_status === "") {
          return c.json({ error: { code: "invalid_request", message: "Cada checkpoint precisa de courier_status (texto)." } }, 400);
        }
        checkpoints.push({
          checkpoint_id: cp.checkpoint_id ?? `cp_manual_${++this.manualSeq}`,
          checkpoint_time: cp.checkpoint_time ?? brasiliaLocal(this.now()),
          checkpoint_tz: cp.checkpoint_time === undefined ? "-03:00" : (cp.checkpoint_tz ?? null),
          courier_status: cp.courier_status,
          message: cp.message ?? cp.courier_status,
          location: cp.location ?? null,
        });
      }
      this.push(courier, number, ...checkpoints);
      return c.json({ data: { added: checkpoints, total: this.trackings.get(key)!.length } }, 201);
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

/** "2026-10-12 10:30:00" no horário de Brasília (-03:00). */
function brasiliaLocal(date: Date): string {
  return new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}
