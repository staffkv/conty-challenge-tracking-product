export type Config = {
  port: number;
  dbPath: string;
  aggregatorUrl: string;
  aggregatorTimeoutMs: number;
  transitLimitDays: number;
  delayCheckIntervalMs: number;
};

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} precisa ser um inteiro positivo; recebeu "${raw}".`);
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: positiveInt(env, "PORT", 3004),
    dbPath: env.DB_PATH || "data/rastreio.sqlite",
    aggregatorUrl: env.AGGREGATOR_URL || "http://127.0.0.1:3005",
    aggregatorTimeoutMs: positiveInt(env, "AGGREGATOR_TIMEOUT_MS", 5000),
    transitLimitDays: positiveInt(env, "TRANSIT_LIMIT_DAYS", 7),
    delayCheckIntervalMs: positiveInt(env, "DELAY_CHECK_INTERVAL_MS", 15 * 60 * 1000),
  };
}
