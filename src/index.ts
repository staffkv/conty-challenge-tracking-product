import { serve } from "@hono/node-server";
import { readConfig } from "./config.ts";
import { jsonLogger } from "./log.ts";
import { compose } from "./main.ts";

const config = readConfig();
const { app, service } = compose(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`rastreio em http://127.0.0.1:${info.port} (agregador: ${config.aggregatorUrl})`);
});

let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    jsonLogger({ event: "monitor_atraso", ...(await service.checkDelays()) });
  } catch (error) {
    jsonLogger({ event: "monitor_atraso_falhou", message: String(error) });
  } finally {
    running = false;
  }
}, config.delayCheckIntervalMs);
