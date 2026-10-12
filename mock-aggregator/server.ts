import { serve } from "@hono/node-server";
import { MockAggregator } from "./app.ts";
import { SCENARIOS } from "./scenarios.ts";

const mock = new MockAggregator();
mock.onRegister = (_courier, number) => SCENARIOS[number] ?? [];
const port = Number(process.env.PORT ?? 3005);

serve({ fetch: mock.app.fetch, port }, (info) => {
  console.log(`agregador fictício em http://127.0.0.1:${info.port}`);
  console.log(`cenários: ${Object.keys(SCENARIOS).join(", ")}`);
});
