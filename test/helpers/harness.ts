import { MockAggregator } from "../../mock-aggregator/app.ts";
import { FixedClock } from "../../src/clock.ts";
import type { NormalizedStatus, TrackingProvider } from "../../src/domain/types.ts";
import { InMemoryProvider } from "../../src/providers/in-memory.ts";
import { RastreioFakeClient } from "../../src/providers/rastreio-fake/client.ts";
import { openDatabase } from "../../src/storage/db.ts";
import { Repository } from "../../src/storage/repository.ts";
import type { DelayNotification } from "../../src/tracking/notifier.ts";
import { TrackingService } from "../../src/tracking/service.ts";

/**
 * Evento descrito de forma neutra. `raw` é o código dos Correios; `status` é o
 * que o provedor em memória entrega pronto. O agregador fictício recebe só o
 * código bruto, e o adaptador precisa chegar ao mesmo status.
 */
export type Spec = { at: string; raw: string; status: NormalizedStatus | null; location?: string; message?: string };

export type ProviderHarness = {
  provider: TrackingProvider;
  publish(code: string, specs: Spec[]): void;
  setOffline(offline: boolean): void;
};

let checkpointSeq = 0;

export const PROVIDERS: Record<string, () => ProviderHarness> = {
  "provedor em memória": () => {
    const provider = new InMemoryProvider();
    return {
      provider,
      publish: (code, specs) =>
        provider.publish(
          code,
          "correios",
          specs.map((s) => ({
            occurredAt: new Date(s.at),
            status: s.status,
            rawStatus: s.raw,
            description: s.message ?? s.raw,
            location: s.location ?? null,
          })),
        ),
      setOffline: (offline) => provider.failWith(offline ? "indisponivel" : null),
    };
  },
  "cliente HTTP contra o agregador fictício": () => {
    const mock = new MockAggregator();
    const provider = new RastreioFakeClient({ baseUrl: "http://agregador.test", fetch: mock.fetch, timeoutMs: 50 });
    return {
      provider,
      publish: (code, specs) =>
        mock.push(
          "correios",
          code,
          ...specs.map((s) => ({
            // Id novo a cada publicação: reenvio do mesmo evento chega com outro id.
            checkpoint_id: `cp_${++checkpointSeq}`,
            checkpoint_time: s.at,
            courier_status: s.raw,
            message: s.message ?? s.raw,
            location: s.location ?? null,
          })),
        ),
      setOffline: (offline) => mock.setOffline(offline),
    };
  },
};

export function buildService(harness: ProviderHarness, options: { now?: string; defaultLimitHours?: number } = {}) {
  const clock = new FixedClock(options.now ?? "2026-10-01T00:00:00Z");
  const notifications: DelayNotification[] = [];
  const repo = new Repository(openDatabase(":memory:"));
  const service = new TrackingService({
    repo,
    provider: harness.provider,
    clock,
    notifier: { notify: (n) => notifications.push(n) },
    defaultLimitHours: options.defaultLimitHours ?? 72,
  });
  return { service, clock, notifications, repo };
}
