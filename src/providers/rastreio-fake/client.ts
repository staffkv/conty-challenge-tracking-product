import { ProviderError, type TrackingEvent, type TrackingProvider } from "../../domain/types.ts";
import { trackingResponseSchema } from "./payload.ts";
import { STATUS_MAPS } from "./status-map.ts";
import { checkpointsToEvents } from "./to-domain.ts";

export type RastreioFakeOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (event: Record<string, unknown>) => void;
};

type Attempt = { status: number; body: unknown };

/** Cliente HTTP do agregador fictício. Devolve só tipos do domínio. */
export class RastreioFakeClient implements TrackingProvider {
  readonly name = "rastreio-fake";
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly log: (event: Record<string, unknown>) => void;

  constructor(options: RastreioFakeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.log = options.log ?? (() => {});
  }

  supportsCarrier(carrier: string): boolean {
    return Object.hasOwn(STATUS_MAPS, carrier);
  }

  async register(trackingCode: string, carrier: string): Promise<void> {
    // Sem nova tentativa: o cadastro não é uma leitura.
    const res = await this.request("POST", "/trackings", { tracking_number: trackingCode, courier_code: carrier });
    if (res.status === 200 || res.status === 201) return;
    throw this.errorFor(res, `cadastro de ${carrier}/${trackingCode}`);
  }

  async fetchEvents(trackingCode: string, carrier: string): Promise<TrackingEvent[]> {
    const path = `/trackings/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingCode)}`;
    let res: Attempt;
    try {
      res = await this.request("GET", path);
      if (res.status >= 500) res = await this.request("GET", path);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.kind !== "indisponivel") throw error;
      res = await this.request("GET", path);
    }
    if (res.status !== 200) throw this.errorFor(res, `consulta de ${carrier}/${trackingCode}`);

    const parsed = trackingResponseSchema.safeParse(res.body);
    if (!parsed.success) throw new ProviderError("resposta_invalida", "O agregador respondeu fora do formato esperado.");
    const data = parsed.data.data;
    if (data.tracking_number !== trackingCode || data.courier_code !== carrier) {
      throw new ProviderError("resposta_invalida", "O agregador respondeu sobre outro código de rastreio.");
    }

    const { events, discarded } = checkpointsToEvents(carrier, data.checkpoints);
    if (discarded.length > 0) {
      this.log({ event: "checkpoints_descartados", carrier, tracking_code: trackingCode, count: discarded.length });
    }
    return events;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Attempt> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderError("indisponivel", `O agregador não respondeu em ${this.timeoutMs} ms.`));
      }, this.timeoutMs);
    });

    try {
      const call = (async () => {
        const res = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        let parsed: unknown = null;
        if (text !== "") {
          try {
            parsed = JSON.parse(text);
          } catch {
            if (res.ok) throw new ProviderError("resposta_invalida", "O agregador respondeu com JSON inválido.");
          }
        }
        return { status: res.status, body: parsed };
      })();
      return await Promise.race([call, timeout]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("indisponivel", `Falha de rede ao falar com o agregador: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private errorFor(res: Attempt, what: string): ProviderError {
    if (res.status === 404) return new ProviderError("nao_encontrado", `O agregador não conhece o código (${what}).`);
    if (res.status >= 500) return new ProviderError("indisponivel", `O agregador falhou com HTTP ${res.status} (${what}).`);
    return new ProviderError("rejeitado", `O agregador recusou a operação com HTTP ${res.status} (${what}).`);
  }
}
