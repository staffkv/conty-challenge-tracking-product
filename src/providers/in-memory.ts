import { ProviderError, type ProviderErrorKind, type TrackingEvent, type TrackingProvider } from "../domain/types.ts";

/** Provedor em memória para testes: já fala o formato do domínio. */
export class InMemoryProvider implements TrackingProvider {
  readonly name = "in-memory";
  private readonly carriers: ReadonlySet<string>;
  private readonly registered = new Map<string, TrackingEvent[]>();
  private failure: ProviderErrorKind | null = null;

  constructor(carriers: readonly string[] = ["correios", "jadlog", "loggi"]) {
    this.carriers = new Set(carriers);
  }

  supportsCarrier(carrier: string): boolean {
    return this.carriers.has(carrier);
  }

  async register(trackingCode: string, carrier: string): Promise<void> {
    this.throwIfFailing();
    const key = `${carrier}:${trackingCode}`;
    if (!this.registered.has(key)) this.registered.set(key, []);
  }

  async fetchEvents(trackingCode: string, carrier: string): Promise<TrackingEvent[]> {
    this.throwIfFailing();
    const events = this.registered.get(`${carrier}:${trackingCode}`);
    if (!events) throw new ProviderError("nao_encontrado", "Código não cadastrado.");
    return events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) }));
  }

  /** Acrescenta eventos ao que o provedor devolve, na ordem dada. */
  publish(trackingCode: string, carrier: string, events: TrackingEvent[]): void {
    const key = `${carrier}:${trackingCode}`;
    this.registered.set(key, [...(this.registered.get(key) ?? []), ...events]);
  }

  failWith(kind: ProviderErrorKind | null): void {
    this.failure = kind;
  }

  private throwIfFailing(): void {
    if (this.failure) throw new ProviderError(this.failure, `Falha simulada: ${this.failure}.`);
  }
}
