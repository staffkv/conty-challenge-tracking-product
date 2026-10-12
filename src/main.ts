import { systemClock } from "./clock.ts";
import type { Config } from "./config.ts";
import { createApp } from "./app.ts";
import { jsonLogger } from "./log.ts";
import { RastreioFakeClient } from "./providers/rastreio-fake/client.ts";
import { openDatabase } from "./storage/db.ts";
import { Repository } from "./storage/repository.ts";
import { logNotifier } from "./tracking/notifier.ts";
import { TrackingService } from "./tracking/service.ts";

/** Único lugar que escolhe o agregador. Trocar de agregador é trocar esta linha. */
export function compose(config: Config) {
  const provider = new RastreioFakeClient({
    baseUrl: config.aggregatorUrl,
    timeoutMs: config.aggregatorTimeoutMs,
    log: jsonLogger,
  });
  const service = new TrackingService({
    repo: new Repository(openDatabase(config.dbPath)),
    provider,
    clock: systemClock,
    notifier: logNotifier(),
    defaultLimitHours: config.transitLimitHours,
    log: jsonLogger,
  });
  return { app: createApp(service), service };
}
