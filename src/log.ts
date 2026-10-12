export type Logger = (event: Record<string, unknown>) => void;

export const jsonLogger: Logger = (event) => {
  if (process.env.VITEST) return;
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));
};
