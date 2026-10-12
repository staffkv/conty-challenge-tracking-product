import { MockAggregator } from "../mock-aggregator/app.ts";
import { EXAMPLE_CHECKPOINTS } from "../mock-aggregator/scenarios.ts";
import { FixedClock } from "../src/clock.ts";
import { RastreioFakeClient } from "../src/providers/rastreio-fake/client.ts";
import { openDatabase } from "../src/storage/db.ts";
import { Repository } from "../src/storage/repository.ts";
import { TrackingService } from "../src/tracking/service.ts";

export const START = "<!-- exemplo:inicio -->";
export const END = "<!-- exemplo:fim -->";

const CODE = "QB000000002BR";

/** Roda o cenário de exemplo pelo caminho real (cliente HTTP → serviço) e monta o bloco do README. */
export async function renderExampleBlock(): Promise<string> {
  const mock = new MockAggregator();
  mock.onRegister = () => EXAMPLE_CHECKPOINTS;
  const service = new TrackingService({
    repo: new Repository(openDatabase(":memory:")),
    provider: new RastreioFakeClient({ baseUrl: "http://agregador.exemplo", fetch: mock.fetch }),
    clock: new FixedClock("2026-10-03T14:00:00Z"),
    notifier: { notify: () => {} },
    defaultLimitDays: 7,
    newId: () => "shp_exemplo",
  });

  const { view } = await service.register({ trackingCode: CODE, carrier: "correios", reference: "campanha-42/criador-7" });
  const raw = await (await mock.fetch(`http://agregador.exemplo/trackings/correios/${CODE}`)).json();

  return [
    START,
    "Payload bruto do agregador (`GET /trackings/correios/QB000000002BR`):",
    "",
    "```json",
    JSON.stringify(raw, null, 2),
    "```",
    "",
    "Resposta de `POST /v1/shipments` com o relógio parado em 03/10/2026 14:00 UTC:",
    "",
    "```json",
    JSON.stringify(view, null, 2),
    "```",
    END,
  ].join("\n");
}

export function extractBlock(readme: string): string | null {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  if (readme.indexOf(START, start + 1) !== -1 || readme.indexOf(END, end + 1) !== -1) return null;
  return readme.slice(start, end + END.length);
}

export function replaceBlock(readme: string, block: string): string {
  const current = extractBlock(readme);
  if (current === null) throw new Error(`O README precisa ter exatamente um par ${START} … ${END}.`);
  return readme.replace(current, block);
}
